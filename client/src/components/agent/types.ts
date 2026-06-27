/**
 * Shared UI types for the Agent tab. (Previously mock-data.ts — the mock data
 * was removed once the tab was wired to the real Agent backend.)
 */

export type AgentCategory = 'coding' | 'document' | 'slides' | 'spreadsheet';

export type AgentMode = 'plan' | 'steer';

export type AgentPlanStatus = 'proposed' | 'running' | 'done';

export interface AgentPlanStep {
  id: string;
  title: string;
  detail?: string;
  status: 'pending' | 'running' | 'done';
}

export interface AgentPlan {
  id: string;
  status: AgentPlanStatus;
  steps: AgentPlanStep[];
}

export type AgentFileKind =
  | 'code'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'json'
  | 'markdown'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'config'
  | 'text';

/** Kinds the preview dialog can render: PDF inline, the rest as read-only source. */
export const PREVIEWABLE_KINDS: ReadonlySet<AgentFileKind> = new Set([
  'pdf',
  'code',
  'json',
  'markdown',
  'config',
  'text'
]);

export interface AgentFileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  kind?: AgentFileKind;
  sizeLabel?: string;
  updatedAtLabel: string;
  children?: AgentFileNode[];
}
