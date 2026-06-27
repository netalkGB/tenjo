import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import { urlPath, urlPathWithQuery } from '@/lib/urlPath';
import { csrfWebSocketUrl } from './csrfWebSocketUrl';
import {
  CreateAgentProjectResponseSchema,
  ListAgentProjectsParamsSchema,
  ListAgentProjectsResponseSchema,
  GetAgentProjectResponseSchema,
  AgentProjectDtoSchema,
  AgentFileTreeResponseSchema,
  SandboxStatusResponseSchema,
  AgentGuiStatusResponseSchema,
  type CreateAgentProjectInput,
  type AgentProjectDto,
  type ListAgentProjectsParams,
  type ListAgentProjectsResponse,
  type GetAgentProjectResponse
} from './schemas';
import type { SandboxStatus } from '@/contexts/agent-reducer';
import type { ContextFileRef } from './schemas';
import type { AgentFileNode, AgentMode } from '@/components/agent/types';

const AGENT_PROJECTS_PATH = urlPath('api', 'agent', 'projects');

function agentProjectPath(projectId: string, ...segments: string[]): string {
  return urlPath('api', 'agent', 'projects', projectId, ...segments);
}

function csrfQueryParam(): Record<string, string> {
  const token = document.body.dataset.csrfToken;
  return token ? { _csrf: token } : {};
}

export async function createAgentProject(
  input: CreateAgentProjectInput = {}
): Promise<string> {
  try {
    const response = await axios.post(AGENT_PROJECTS_PATH, input);
    return CreateAgentProjectResponseSchema.parse(response.data).projectId;
  } catch (error) {
    handleApiError(error);
  }
}

/** Current shared-sandbox lifecycle status, for an initial render before SSE. */
export async function fetchSandboxStatus(): Promise<SandboxStatus> {
  try {
    const response = await axios.get('/api/agent/sandbox-status');
    const { status, detail } = SandboxStatusResponseSchema.parse(response.data);
    return { status, detail };
  } catch (error) {
    handleApiError(error);
  }
}

export async function listAgentProjects(
  params: ListAgentProjectsParams = {}
): Promise<ListAgentProjectsResponse> {
  try {
    const validatedParams = ListAgentProjectsParamsSchema.parse(params);
    const response = await axios.get(AGENT_PROJECTS_PATH, {
      params: validatedParams
    });
    return ListAgentProjectsResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function getAgentProject(
  id: string
): Promise<GetAgentProjectResponse> {
  try {
    const response = await axios.get(agentProjectPath(id));
    return GetAgentProjectResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function patchAgentProject(
  id: string,
  patch: { title?: string; pinned?: boolean; mode?: 'plan' | 'steer' }
): Promise<AgentProjectDto> {
  try {
    const response = await axios.patch(agentProjectPath(id), patch);
    return AgentProjectDtoSchema.parse(
      (response.data as { project: unknown }).project
    );
  } catch (error) {
    handleApiError(error);
  }
}

export async function deleteAgentProject(id: string): Promise<void> {
  try {
    await axios.delete(agentProjectPath(id));
  } catch (error) {
    handleApiError(error);
  }
}

/** Build the download URL for a sandbox artifact (served as binary). */
export function agentFileDownloadUrl(projectId: string, path: string): string {
  return urlPathWithQuery(agentProjectPath(projectId, 'files'), {
    path,
    ...csrfQueryParam()
  });
}

/** Build the download URL for the whole workspace as a ZIP archive. */
export function agentWorkspaceZipUrl(projectId: string): string {
  const csrf = csrfQueryParam();
  const path = agentProjectPath(projectId, 'zip');
  return Object.keys(csrf).length > 0 ? urlPathWithQuery(path, csrf) : path;
}

/** Fetch a sandbox artifact as a Blob (for in-browser previews). */
export async function getAgentFileBlob(
  projectId: string,
  path: string
): Promise<Blob> {
  try {
    const response = await axios.get<Blob>(
      agentProjectPath(projectId, 'files'),
      { params: { path }, responseType: 'blob' }
    );
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}

// ---- commands (the SSE stream is read-only; these drive the agent) ---------

export async function submitAgentMessage(
  projectId: string,
  input: {
    text: string;
    mode: AgentMode;
    contextFiles?: ContextFileRef[];
    /** Knowledge entries to transcribe into the sandbox as context files. */
    knowledgeIds?: string[];
    /** Whether the web-search sub-agent tool is available to the agent. */
    webSearchEnabled?: boolean;
    /** Whether web search may run for up to 600 seconds instead of 200. */
    webSearchExtendedTimeoutEnabled?: boolean;
  }
): Promise<void> {
  try {
    await axios.post(agentProjectPath(projectId, 'messages'), input);
  } catch (error) {
    handleApiError(error);
  }
}

export async function decideAgentPlan(
  projectId: string,
  action: 'approve' | 'reject',
  feedback?: string
): Promise<void> {
  try {
    await axios.post(agentProjectPath(projectId, 'plan'), {
      action,
      feedback
    });
  } catch (error) {
    handleApiError(error);
  }
}

export async function abortAgent(
  projectId: string,
  clearQueue = false
): Promise<void> {
  try {
    await axios.post(agentProjectPath(projectId, 'abort'), { clearQueue });
  } catch (error) {
    handleApiError(error);
  }
}

/** Approve or reject a pending MCP tool call surfaced by a tool-approval event. */
export async function approveAgentToolCall(
  projectId: string,
  toolCallId: string,
  approved: boolean
): Promise<void> {
  try {
    await axios.post(
      agentProjectPath(projectId, 'tools', toolCallId, 'approve'),
      { approved }
    );
  } catch (error) {
    handleApiError(error);
  }
}

/** Answer a pending ask_user_question surfaced by a `question` event. */
export async function answerAgentQuestion(
  projectId: string,
  questionId: string,
  answer: string
): Promise<void> {
  try {
    await axios.post(
      agentProjectPath(projectId, 'questions', questionId, 'answer'),
      { answer }
    );
  } catch (error) {
    handleApiError(error);
  }
}

export async function removeAgentQueueItem(
  projectId: string,
  itemId: string
): Promise<void> {
  try {
    await axios.delete(agentProjectPath(projectId, 'queue', itemId));
  } catch (error) {
    handleApiError(error);
  }
}

/** Delete an uploaded context file. */
export async function deleteAgentContextFile(
  projectId: string,
  path: string
): Promise<void> {
  try {
    await axios.delete(agentProjectPath(projectId, 'context-files'), {
      params: { path }
    });
  } catch (error) {
    handleApiError(error);
  }
}

// ---- GUI preview (VNC sidecar) ----------------------------------------------

/** Start the GUI preview; progress arrives as `gui-status` SSE events. */
export async function startAgentGui(projectId: string): Promise<void> {
  try {
    await axios.post(agentProjectPath(projectId, 'gui', 'start'));
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Open the GUI preview on a page: the server makes sure the dev server behind
 * the URL is running (restarting it from the agent-recorded manifest when
 * needed) before starting/navigating the GUI. Without a URL the most recently
 * recorded dev server is used. Progress arrives as `gui-status` SSE events.
 */
export async function openAgentGui(
  projectId: string,
  url?: string,
  /** Whether the desktop should include the Japanese IME (UI language = ja). */
  ime?: boolean
): Promise<void> {
  try {
    await axios.post(agentProjectPath(projectId, 'gui', 'open'), {
      url,
      ime
    });
  } catch (error) {
    handleApiError(error);
  }
}

export async function stopAgentGui(projectId: string): Promise<void> {
  try {
    await axios.post(agentProjectPath(projectId, 'gui', 'stop'));
  } catch (error) {
    handleApiError(error);
  }
}

/** Toggle the GUI's IME (direct input ⇄ Mozc) from outside the VNC keyboard. */
export async function toggleAgentGuiIme(projectId: string): Promise<void> {
  try {
    await axios.post(agentProjectPath(projectId, 'gui', 'ime-toggle'));
  } catch (error) {
    handleApiError(error);
  }
}

/** Current GUI preview status, for an initial render before SSE pushes one. */
export async function fetchAgentGuiStatus(
  projectId: string
): Promise<'stopped' | 'starting' | 'running' | 'stopping' | 'error'> {
  try {
    const response = await axios.get(agentProjectPath(projectId, 'gui'));
    return AgentGuiStatusResponseSchema.parse(response.data).status;
  } catch (error) {
    handleApiError(error);
  }
}

/** WebSocket URL of the authenticated VNC relay for a project. */
export function agentVncUrl(projectId: string): string {
  return csrfWebSocketUrl(agentProjectPath(projectId, 'vnc'));
}

export async function getAgentFileTree(
  projectId: string
): Promise<AgentFileNode[]> {
  try {
    const response = await axios.get(
      agentProjectPath(projectId, 'files', 'tree')
    );
    return AgentFileTreeResponseSchema.parse(response.data).nodes;
  } catch (error) {
    handleApiError(error);
  }
}
