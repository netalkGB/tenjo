import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSandbox } from 'tenjo-chat-engine';
import { ZipUtils } from '../../utils/zipUtils';
import {
  PunchSkillService,
  PunchSkillNotFoundError
} from '../PunchSkillService';
import type { PunchSkillRepository } from '../../repositories/PunchSkillRepository';
import type { FileUploadService } from '../FileUploadService';

function makeSkillZip(files: Record<string, string>): Buffer {
  return ZipUtils.createArchive(
    Object.entries(files).map(([filePath, content]) => ({
      path: filePath,
      content: Buffer.from(content, 'utf8')
    }))
  );
}

describe('PunchSkillService.loadSkillIntoSandbox', () => {
  let baseDir: string;
  let workspaceDir: string;
  let sandbox: LocalSandbox;
  let zipBuffer: Buffer;
  let fileUploadService: FileUploadService;
  let punchSkillRepo: PunchSkillRepository;
  let service: PunchSkillService;

  beforeEach(async () => {
    // workspace + sibling .skills under an isolated base dir
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'punch-test-'));
    workspaceDir = path.join(baseDir, 'workspace');
    await fs.mkdir(workspaceDir);
    sandbox = new LocalSandbox(workspaceDir);
    zipBuffer = makeSkillZip({
      'SKILL.md':
        '---\nname: demo-skill\ndescription: A demo skill for tests\n---\n\nDo the demo thing.\n',
      'references/note.md': '# Note\nDetails here.\n',
      'scripts/hello.sh': '#!/bin/sh\necho hello\n'
    });

    fileUploadService = {
      save: vi.fn(),
      read: vi.fn(async () => zipBuffer),
      readText: vi.fn(),
      delete: vi.fn()
    } as unknown as FileUploadService;

    punchSkillRepo = {
      findByUserIdAndName: vi.fn(async () => ({
        id: 'skill-1',
        name: 'demo-skill',
        description: 'A demo skill for tests',
        enabled: true,
        fs_path: '/artifacts/demo.zip',
        created_by: 'user-1',
        updated_by: 'user-1',
        created_at: new Date(),
        updated_at: new Date()
      }))
    } as unknown as PunchSkillRepository;

    service = new PunchSkillService(punchSkillRepo, fileUploadService);
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('extracts the package outside the workspace and returns SKILL.md only', async () => {
    const result = await service.loadSkillIntoSandbox(
      'user-1',
      'demo-skill',
      sandbox
    );

    expect(result.ok).toBe(true);
    expect(result.skill_name).toBe('demo-skill');
    expect(result.instructions).toContain('Do the demo thing');
    expect(result.files).toEqual(
      expect.arrayContaining([
        'SKILL.md',
        'references/note.md',
        'scripts/hello.sh'
      ])
    );

    const skillsRoot = sandbox.getSkillsRoot();
    expect(result.skill_path).toBe(`${path.join(skillsRoot, 'demo-skill')}/`);

    // Outside workspace: not under workspaceDir.
    expect(result.skill_path.startsWith(workspaceDir)).toBe(false);
    expect(
      path.resolve(result.skill_path).startsWith(path.resolve(workspaceDir))
    ).toBe(false);

    const note = await fs.readFile(
      path.join(skillsRoot, 'demo-skill', 'references', 'note.md'),
      'utf8'
    );
    expect(note).toContain('Details here');

    // Workspace itself stays empty of skill files.
    const wsEntries = await fs.readdir(workspaceDir);
    expect(wsEntries).toEqual([]);
  });

  it('rejects disabled skills', async () => {
    (
      punchSkillRepo.findByUserIdAndName as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'skill-1',
      name: 'demo-skill',
      description: 'A demo skill for tests',
      enabled: false,
      fs_path: '/artifacts/demo.zip',
      created_by: 'user-1',
      updated_by: 'user-1',
      created_at: new Date(),
      updated_at: new Date()
    });

    await expect(
      service.loadSkillIntoSandbox('user-1', 'demo-skill', sandbox)
    ).rejects.toBeInstanceOf(PunchSkillNotFoundError);
  });
});
