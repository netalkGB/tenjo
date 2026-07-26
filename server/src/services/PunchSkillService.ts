import path from 'node:path';
import {
  PUNCH_TOOL_DEFINITION,
  type Sandbox,
  type Tool
} from 'tenjo-chat-engine';
import { ServiceError } from '../errors/ServiceError';
import logger from '../logger';
import type {
  PunchSkill,
  PunchSkillRepository,
  PaginatedPunchSkillResult,
  PunchSkillListOptions
} from '../repositories/PunchSkillRepository';
import type { FileUploadService } from './FileUploadService';
import { generateUuidV4 } from '../utils/generateUuidV4';
import {
  findSkillPackageRoot,
  parseSkillManifest,
  SkillManifestError,
  type SkillManifest
} from '../utils/skillManifest';
import { ZipExtractError, ZipUtils, type ZipEntry } from '../utils/zipUtils';

export class PunchSkillNotFoundError extends ServiceError {
  constructor(message: string = 'Punch skill not found') {
    super(message);
  }
}

export class PunchSkillValidationError extends ServiceError {}

export class PunchSkillConflictError extends ServiceError {}

/** Max ZIP upload size in bytes. */
export const PUNCH_ZIP_MAX_SIZE = 5 * 1024 * 1024;

/**
 * Punch skills are stored as artifact ZIPs under `{DATA_DIR}/artifacts/`.
 * On load they are extracted onto the sandbox filesystem under the skills root
 * (outside the workspace) so agents can read/run package files progressively —
 * never written into the workspace tree.
 */
export class PunchSkillService {
  constructor(
    private readonly punchSkillRepo: PunchSkillRepository,
    private readonly fileUploadService: FileUploadService
  ) {}

  async list(
    userId: string,
    options: PunchSkillListOptions = {}
  ): Promise<PunchSkill[]> {
    if (!options.search && (!options.enabled || options.enabled === 'all')) {
      return this.punchSkillRepo.findByUserId(userId);
    }
    return this.punchSkillRepo.findByUserIdFiltered(userId, options);
  }

  async search(
    userId: string,
    query: string,
    options: Omit<PunchSkillListOptions, 'search'> = {}
  ): Promise<PunchSkill[]> {
    return this.punchSkillRepo.findByUserIdFiltered(userId, {
      ...options,
      search: query
    });
  }

  async findPaginated(
    userId: string,
    pageSize: number,
    pageNumber: number,
    options: PunchSkillListOptions = {}
  ): Promise<PaginatedPunchSkillResult> {
    return this.punchSkillRepo.findPaginated(
      userId,
      pageSize,
      pageNumber,
      options
    );
  }

  async listEnabled(userId: string): Promise<PunchSkill[]> {
    return this.punchSkillRepo.findEnabledByUserId(userId);
  }

  async getById(id: string, userId: string): Promise<PunchSkill> {
    const skill = await this.punchSkillRepo.findById(id);
    if (!skill || skill.created_by !== userId) {
      throw new PunchSkillNotFoundError();
    }
    return skill;
  }

  /** Validate a skill ZIP and store it as an artifact. */
  async importFromZip(
    userId: string,
    zipBuffer: Buffer,
    _filename?: string
  ): Promise<PunchSkill> {
    if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
      throw new PunchSkillValidationError('ZIP file is empty');
    }
    if (zipBuffer.length > PUNCH_ZIP_MAX_SIZE) {
      throw new PunchSkillValidationError(
        `ZIP exceeds maximum size of ${PUNCH_ZIP_MAX_SIZE} bytes`
      );
    }

    const { manifest } = parseSkillZip(zipBuffer);

    const existing = await this.punchSkillRepo.findByUserIdAndName(
      userId,
      manifest.name
    );
    if (existing) {
      throw new PunchSkillConflictError(
        `A skill named "${manifest.name}" is already imported`
      );
    }

    const filename = `${generateUuidV4()}.zip`;
    const fsPath = await this.fileUploadService.save(filename, zipBuffer);

    try {
      return await this.punchSkillRepo.create({
        name: manifest.name,
        description: manifest.description,
        enabled: true,
        fs_path: fsPath,
        created_by: userId,
        updated_by: userId
      });
    } catch (err) {
      await this.fileUploadService.delete(filename);
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === '23505'
      ) {
        throw new PunchSkillConflictError(
          `A skill named "${manifest.name}" is already imported`
        );
      }
      throw err;
    }
  }

  async setEnabled(
    id: string,
    userId: string,
    enabled: boolean
  ): Promise<PunchSkill> {
    await this.getById(id, userId);
    const updated = await this.punchSkillRepo.update(id, {
      enabled,
      updated_by: userId,
      updated_at: new Date()
    });
    if (!updated) {
      throw new PunchSkillNotFoundError();
    }
    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    const skill = await this.getById(id, userId);
    // DB first, then artifact (same order as KnowledgeService.delete).
    const deleted = await this.punchSkillRepo.delete(id);
    if (!deleted) {
      throw new PunchSkillNotFoundError();
    }
    await this.fileUploadService.delete(path.basename(skill.fs_path));
  }

  /** Delete all skills for a user (DB rows and artifact ZIPs). */
  async deleteAllForUser(userId: string): Promise<void> {
    const removed = await this.punchSkillRepo.deleteByUserId(userId);
    await Promise.all(
      removed.map((skill) =>
        this.fileUploadService.delete(path.basename(skill.fs_path))
      )
    );
  }

  /** Artifact paths referenced by punch_skills (for FileCleanupService). */
  async listStoredFsPaths(): Promise<string[]> {
    return this.punchSkillRepo.listAllFsPaths();
  }

  /**
   * Load skill instructions and extract the package onto the sandbox under
   * `{skillsRoot}/{name}/` (outside the workspace). Tool result carries
   * SKILL.md body + paths only — not full supporting file contents.
   */
  async loadSkillIntoSandbox(
    userId: string,
    skillName: string,
    sandbox: Sandbox
  ): Promise<PunchLoadResult> {
    const skill = await this.punchSkillRepo.findByUserIdAndName(
      userId,
      skillName
    );
    if (!skill || skill.created_by !== userId) {
      throw new PunchSkillNotFoundError(`Unknown skill: ${skillName}`);
    }
    if (!skill.enabled) {
      throw new PunchSkillNotFoundError(
        `Skill "${skillName}" is disabled. Enable it in Punch settings.`
      );
    }

    const skillsRoot = sandbox.getSkillsRoot?.();
    const writeOutside = sandbox.writeOutsideWorkspace?.bind(sandbox);
    if (!skillsRoot || !writeOutside) {
      throw new PunchSkillValidationError(
        'Sandbox does not support skill packages outside the workspace'
      );
    }

    let zipBuffer: Buffer;
    try {
      zipBuffer = await this.fileUploadService.read(
        path.basename(skill.fs_path)
      );
    } catch {
      throw new PunchSkillNotFoundError(
        'Skill package file is missing on disk'
      );
    }

    const packageFiles = parseSkillZip(zipBuffer).entries;
    const skillMd = packageFiles.find((e) => e.path === 'SKILL.md');
    if (!skillMd) {
      throw new PunchSkillNotFoundError(
        `Skill "${skillName}" package is missing SKILL.md`
      );
    }

    let instructions: string;
    try {
      instructions = parseSkillManifest(skillMd.content.toString('utf8')).body;
    } catch (err) {
      const message =
        err instanceof SkillManifestError ? err.message : String(err);
      throw new PunchSkillValidationError(
        `Skill "${skillName}" has invalid SKILL.md: ${message}`
      );
    }

    const skillPath = joinSkillsPath(skillsRoot, skill.name);
    const files: string[] = [];

    for (const entry of packageFiles) {
      // ZipUtils already rejects ".." segments; keep materialization path-safe.
      const absolutePath = joinSkillsPath(skillPath, entry.path);
      files.push(entry.path);
      try {
        await writeOutside(absolutePath, entry.content);
      } catch (err) {
        logger.warn('[punch] failed to write skill file outside workspace', {
          skillName,
          path: entry.path,
          absolutePath,
          error: err
        });
        throw new PunchSkillValidationError(
          `Failed to materialize skill file "${entry.path}" on sandbox: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    return {
      ok: true,
      skill_name: skill.name,
      instructions,
      skill_path: `${skillPath}/`,
      files
    };
  }

  createPunchTool(userId: string, sandbox: Sandbox): Tool {
    return {
      definition: PUNCH_TOOL_DEFINITION,
      handler: async (args) => {
        const name =
          typeof args.skill_name === 'string' ? args.skill_name.trim() : '';
        if (!name) {
          return { ok: false, error: 'Missing argument: skill_name' };
        }
        try {
          const skill = await this.punchSkillRepo.findByUserIdAndName(
            userId,
            name
          );
          if (!skill || !skill.enabled || skill.created_by !== userId) {
            return {
              ok: false,
              error: `Unknown or disabled skill: ${name}`
            };
          }
          return await this.loadSkillIntoSandbox(userId, name, sandbox);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }
    };
  }
}

export interface PunchLoadResult {
  ok: true;
  skill_name: string;
  /** SKILL.md body (instructions only). */
  instructions: string;
  /** Absolute package directory on the sandbox, outside the workspace. */
  skill_path: string;
  /** Package-relative file paths that were materialized under skill_path. */
  files: string[];
}

/** Join POSIX-style absolute skills paths (sandbox paths always use `/`). */
function joinSkillsPath(root: string, ...parts: string[]): string {
  const base = root.replace(/\/+$/, '');
  const joined = parts
    .flatMap((p) => p.split('/'))
    .filter((s) => s.length > 0 && s !== '.')
    .join('/');
  return joined ? `${base}/${joined}` : base;
}

/** Validate a skill ZIP and return package entries plus the parsed manifest. */
function parseSkillZip(zipBuffer: Buffer): {
  manifest: SkillManifest;
  entries: ZipEntry[];
} {
  let rawEntries: ZipEntry[];
  try {
    rawEntries = ZipUtils.extractArchive(zipBuffer, {
      maxEntries: 200,
      maxTotalUncompressedBytes: 20 * 1024 * 1024,
      maxEntryUncompressedBytes: PUNCH_ZIP_MAX_SIZE
    });
  } catch (err) {
    if (err instanceof ZipExtractError) {
      throw new PunchSkillValidationError(err.message);
    }
    throw err;
  }

  if (rawEntries.length === 0) {
    throw new PunchSkillValidationError('ZIP contains no files');
  }

  let packageRoot: string;
  try {
    packageRoot = findSkillPackageRoot(rawEntries.map((e) => e.path));
  } catch (err) {
    if (err instanceof SkillManifestError) {
      throw new PunchSkillValidationError(err.message);
    }
    throw err;
  }

  const entries: ZipEntry[] = [];
  for (const entry of rawEntries) {
    if (packageRoot && !entry.path.startsWith(packageRoot)) continue;
    const rel = packageRoot ? entry.path.slice(packageRoot.length) : entry.path;
    if (!rel || rel.endsWith('/')) continue;
    entries.push({ path: rel, content: entry.content });
  }

  const skillMd = entries.find((e) => e.path === 'SKILL.md');
  if (!skillMd) {
    throw new PunchSkillValidationError('ZIP must contain a SKILL.md file');
  }

  let manifest: SkillManifest;
  try {
    manifest = parseSkillManifest(skillMd.content.toString('utf8'));
  } catch (err) {
    if (err instanceof SkillManifestError) {
      throw new PunchSkillValidationError(err.message);
    }
    throw err;
  }

  return { manifest, entries };
}

export { PUNCH_TOOL_NAME } from 'tenjo-chat-engine';
