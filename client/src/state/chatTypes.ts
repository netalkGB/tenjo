import type { ToolCallInfo } from '@/components/chat';
import type { ToolCallEvent } from '@/api/server/chat';

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'toolCall'; toolCallId: string };

export interface Message {
  id?: string;
  type: 'user' | 'assistant';
  content: string;
  thinkingContent?: string;
  imageUrls?: string[];
  isStreaming?: boolean;
  currentCount?: number | null;
  totalCount?: number | null;
  siblings?: string[];
  parentMessageId?: string | null;
  model?: string | null;
  provider?: string | null;
  toolCalls?: ToolCallInfo[];
  contentParts?: MessagePart[];
}

export interface ChatState {
  messages: Message[];
}

export enum ChatActionType {
  SET_MESSAGES = 'SET_MESSAGES',
  STOP_STREAMING = 'STOP_STREAMING',
  UPDATE_BRANCH_STATUS = 'UPDATE_BRANCH_STATUS',
  APPEND_OPTIMISTIC_SEND = 'APPEND_OPTIMISTIC_SEND',
  REPLACE_OPTIMISTIC_EDIT = 'REPLACE_OPTIMISTIC_EDIT',
  APPEND_CHUNK = 'APPEND_CHUNK',
  APPEND_THINKING_CHUNK = 'APPEND_THINKING_CHUNK',
  COMPLETE_STREAMING = 'COMPLETE_STREAMING',
  REVERT_SEND = 'REVERT_SEND',
  UPDATE_TOOL_CALL = 'UPDATE_TOOL_CALL',
  UPDATE_TOOL_APPROVAL = 'UPDATE_TOOL_APPROVAL'
}

export type ChatAction =
  | {
      type: ChatActionType.SET_MESSAGES;
      payload: Message[];
    }
  | {
      type: ChatActionType.STOP_STREAMING;
    }
  | {
      type: ChatActionType.UPDATE_BRANCH_STATUS;
      payload: Record<
        string,
        { currentCount: number; totalCount: number; siblings: string[] }
      >;
    }
  | {
      type: ChatActionType.APPEND_OPTIMISTIC_SEND;
      payload: {
        message: string;
        imageUrls?: string[];
        parentMessageId?: string;
      };
    }
  | {
      type: ChatActionType.REPLACE_OPTIMISTIC_EDIT;
      payload: {
        editIndex: number;
        editedMessage: string;
        imageUrls?: string[];
        parentMessageId?: string | null;
      };
    }
  | {
      type: ChatActionType.APPEND_CHUNK;
      payload: { chunk: string };
    }
  | {
      type: ChatActionType.APPEND_THINKING_CHUNK;
      payload: { chunk: string };
    }
  | {
      type: ChatActionType.COMPLETE_STREAMING;
      payload: {
        userMessageId?: string;
        assistantMessageId?: string;
        model?: string;
        provider?: string;
      };
    }
  | {
      type: ChatActionType.REVERT_SEND;
    }
  | {
      type: ChatActionType.UPDATE_TOOL_CALL;
      payload: ToolCallEvent;
    }
  | {
      type: ChatActionType.UPDATE_TOOL_APPROVAL;
      payload: {
        toolCallId: string;
        approved: boolean;
      };
    };
