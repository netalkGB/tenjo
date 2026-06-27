import type { WorkspaceIntentLexicon } from './workspaceIntent.js';

export const DEFAULT_WORKSPACE_INTENT_LEXICON: WorkspaceIntentLexicon = {
  deliverableTypes: [
    { keywords: ['pdf'], extensions: ['.pdf'] },
    {
      keywords: ['docx', 'doc'],
      extensions: ['.docx', '.doc'],
    },
    {
      keywords: ['xlsx', 'xls', 'csv'],
      extensions: ['.xlsx', '.xls', '.csv'],
    },
    {
      keywords: ['pptx', 'ppt'],
      extensions: ['.pptx', '.ppt'],
    },
    {
      keywords: ['png', 'jpeg', 'jpg', 'svg', 'gif', 'webp'],
      extensions: ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp'],
    },
  ],
  programIntentKeywords: [],
  finalDocumentExtensions: [
    '.pdf',
    '.docx',
    '.doc',
    '.xlsx',
    '.xls',
    '.pptx',
    '.ppt',
  ],
};
