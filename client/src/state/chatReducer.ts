import { ChatState, ChatAction, ChatActionType } from './chatTypes';

export const initialChatState: ChatState = {
  messages: []
};

export const chatReducer = (
  state: ChatState,
  action: ChatAction
): ChatState => {
  switch (action.type) {
    case ChatActionType.SET_MESSAGES:
      return {
        ...state,
        messages: action.payload
      };

    case ChatActionType.STOP_STREAMING:
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.isStreaming ? { ...msg, isStreaming: undefined } : msg
        )
      };

    case ChatActionType.UPDATE_BRANCH_STATUS:
      return {
        ...state,
        messages: state.messages.map(msg => {
          if (!msg.id) return msg;
          const branchInfo = action.payload[msg.id];
          if (!branchInfo) return msg;
          return {
            ...msg,
            currentCount: branchInfo.currentCount,
            totalCount: branchInfo.totalCount,
            siblings: branchInfo.siblings
          };
        })
      };

    case ChatActionType.APPEND_OPTIMISTIC_SEND:
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            type: 'user' as const,
            content: action.payload.message,
            imageUrls:
              action.payload.imageUrls && action.payload.imageUrls.length > 0
                ? action.payload.imageUrls
                : undefined,
            parentMessageId: action.payload.parentMessageId
          },
          {
            type: 'assistant' as const,
            content: '',
            isStreaming: true,
            parentMessageId: undefined
          }
        ]
      };

    case ChatActionType.REPLACE_OPTIMISTIC_EDIT:
      return {
        ...state,
        messages: [
          ...state.messages.slice(0, action.payload.editIndex),
          {
            type: 'user' as const,
            content: action.payload.editedMessage,
            parentMessageId: action.payload.parentMessageId
          },
          {
            type: 'assistant' as const,
            content: '',
            isStreaming: true,
            parentMessageId: undefined
          }
        ]
      };

    case ChatActionType.APPEND_CHUNK: {
      const messages = [...state.messages];
      const lastIndex = messages.length - 1;
      if (
        lastIndex >= 0 &&
        messages[lastIndex].type === 'assistant' &&
        messages[lastIndex].isStreaming
      ) {
        messages[lastIndex] = {
          ...messages[lastIndex],
          content: messages[lastIndex].content + action.payload.chunk
        };
      }
      return { ...state, messages };
    }

    case ChatActionType.APPEND_THINKING_CHUNK: {
      const messages = [...state.messages];
      const lastIndex = messages.length - 1;
      if (
        lastIndex >= 0 &&
        messages[lastIndex].type === 'assistant' &&
        messages[lastIndex].isStreaming
      ) {
        messages[lastIndex] = {
          ...messages[lastIndex],
          thinkingContent:
            (messages[lastIndex].thinkingContent ?? '') + action.payload.chunk
        };
      }
      return { ...state, messages };
    }

    case ChatActionType.COMPLETE_STREAMING: {
      const messages = [...state.messages];
      const { userMessageId, assistantMessageId, model, provider } =
        action.payload;

      // Set ID on the second-to-last element (user message).
      if (
        messages.length >= 2 &&
        messages[messages.length - 2].type === 'user'
      ) {
        messages[messages.length - 2] = {
          ...messages[messages.length - 2],
          id: userMessageId
        };
      }

      // Set ID on the last element (assistant message) and remove the streaming flag.
      const lastIndex = messages.length - 1;
      if (
        lastIndex >= 0 &&
        messages[lastIndex].type === 'assistant' &&
        messages[lastIndex].isStreaming
      ) {
        const { isStreaming: _isStreaming, ...rest } = messages[lastIndex];
        messages[lastIndex] = {
          ...rest,
          id: assistantMessageId,
          parentMessageId: userMessageId,
          model: model ?? null,
          provider: provider ?? null
        };
      }
      return { ...state, messages };
    }

    case ChatActionType.REVERT_SEND: {
      const messages = [...state.messages];
      if (messages.length >= 2) {
        // Remove the streaming assistant message.
        if (
          messages[messages.length - 1].type === 'assistant' &&
          messages[messages.length - 1].isStreaming
        ) {
          messages.pop();
        }
        // Remove the user message.
        if (messages[messages.length - 1].type === 'user') {
          messages.pop();
        }
      }
      return { ...state, messages };
    }

    case ChatActionType.UPDATE_TOOL_CALL: {
      const messages = [...state.messages];
      const lastIndex = messages.length - 1;
      if (lastIndex < 0 || messages[lastIndex].type !== 'assistant')
        return state;

      const msg = { ...messages[lastIndex] };
      const toolCalls = [...(msg.toolCalls || [])];
      const event = action.payload;

      if (event.type === 'approval_request') {
        toolCalls.push({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          toolArgs: event.toolArgs,
          status: 'pendingApproval'
        });
      } else if (event.type === 'calling') {
        const idx = toolCalls.findIndex(
          tc => tc.toolCallId === event.toolCallId
        );
        if (idx !== -1) {
          toolCalls[idx] = { ...toolCalls[idx], status: 'calling' };
        } else {
          toolCalls.push({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolArgs: event.toolArgs,
            status: 'calling'
          });
        }
      } else if (event.type === 'result') {
        const idx = toolCalls.findIndex(
          tc => tc.toolCallId === event.toolCallId
        );
        if (idx !== -1) {
          toolCalls[idx] = {
            ...toolCalls[idx],
            result: event.result,
            success: event.success,
            status: 'completed'
          };
        }
      }

      msg.toolCalls = toolCalls;
      messages[lastIndex] = msg;
      return { ...state, messages };
    }

    case ChatActionType.UPDATE_TOOL_APPROVAL: {
      const messages = [...state.messages];
      const lastIndex = messages.length - 1;
      if (lastIndex < 0 || messages[lastIndex].type !== 'assistant')
        return state;

      const msg = { ...messages[lastIndex] };
      const toolCalls = [...(msg.toolCalls || [])];
      const idx = toolCalls.findIndex(
        tc => tc.toolCallId === action.payload.toolCallId
      );
      if (idx !== -1) {
        if (action.payload.approved) {
          toolCalls[idx] = { ...toolCalls[idx], status: 'calling' };
        } else {
          toolCalls[idx] = {
            ...toolCalls[idx],
            status: 'completed',
            success: false,
            result: { error: 'Rejected by user' }
          };
        }
      }
      msg.toolCalls = toolCalls;
      messages[lastIndex] = msg;
      return { ...state, messages };
    }

    default:
      return state;
  }
};
