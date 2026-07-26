import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import {
  PunchSkillSchema,
  PunchSkillListResponseSchema,
  PunchSkillPaginatedResponseSchema,
  PunchEnabledListResponseSchema,
  type PunchSkill,
  type PunchEnabledSkill,
  type PunchSkillPaginatedResponse,
  type PunchSkillEnabledFilter
} from './schemas';

export type {
  PunchSkill,
  PunchEnabledSkill,
  PunchSkillPaginatedResponse,
  PunchSkillEnabledFilter
} from './schemas';

export interface ListPunchSkillsOptions {
  search?: string;
  enabled?: PunchSkillEnabledFilter;
}

export async function listPunchSkills(
  options: ListPunchSkillsOptions = {}
): Promise<PunchSkill[]> {
  try {
    const params: Record<string, string> = {};
    if (options.search) params.search = options.search;
    if (options.enabled && options.enabled !== 'all') {
      params.enabled = options.enabled;
    }
    const response = await axios.get('/api/punch/skills', { params });
    return PunchSkillListResponseSchema.parse(response.data).skills;
  } catch (error) {
    handleApiError(error);
  }
}

export async function listPunchSkillsPaginated(
  pageNumber: number,
  pageSize: number,
  options: ListPunchSkillsOptions = {}
): Promise<PunchSkillPaginatedResponse> {
  try {
    const params: Record<string, string | number> = {
      pageNumber,
      pageSize
    };
    if (options.search) params.search = options.search;
    if (options.enabled && options.enabled !== 'all') {
      params.enabled = options.enabled;
    }
    const response = await axios.get('/api/punch/skills', { params });
    return PunchSkillPaginatedResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function listEnabledPunchSkills(): Promise<PunchEnabledSkill[]> {
  try {
    const response = await axios.get('/api/punch/skills/enabled');
    return PunchEnabledListResponseSchema.parse(response.data).skills;
  } catch (error) {
    handleApiError(error);
  }
}

export async function importPunchSkill(file: File): Promise<PunchSkill> {
  try {
    const buffer = await file.arrayBuffer();
    const response = await axios.post('/api/punch/import', buffer, {
      headers: {
        'Content-Type': file.type || 'application/zip',
        'x-filename': encodeURIComponent(file.name)
      }
    });
    return PunchSkillSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function setPunchSkillEnabled(
  id: string,
  enabled: boolean
): Promise<PunchSkill> {
  try {
    const response = await axios.patch(`/api/punch/skills/${id}`, { enabled });
    return PunchSkillSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function deletePunchSkill(id: string): Promise<void> {
  try {
    await axios.delete(`/api/punch/skills/${id}`);
  } catch (error) {
    handleApiError(error);
  }
}
