import {
  ChatInput,
  UserMessageSection,
  AssistantMessageSection,
  ChatSkeleton,
  ChatTitleHeader,
  ChatStatusLine,
  ScrollToBottomButton
} from '@/components/chat';
import type { ChatStatus } from '@/components/chat';
import { useLocation, useLoaderData } from 'react-router';
import { MainLayout } from '../layout';
import { Suspense, useEffect, useReducer, useState, useRef, use } from 'react';
import {
  sendMessageToThread,
  editAndResendMessage,
  getThreadMessages,
  ThreadMessagesResponse,
  getBranchStatus,
  switchBranch,
  approveToolCall,
  stopGeneration
} from '@/api/server/chat';
import { uploadImage } from '@/api/server/chat/upload';
import { upsertToolApprovalRule } from '@/api/server/settings';
import type {
  ToolCallEvent,
  ToolCallStreamEvent,
  SubAgentActivityEvent
} from '@/api/server/chat';
import { useHistory } from '@/hooks/useHistory';
import { useSettings } from '@/contexts/settings-context';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { Skeleton } from '@/components/ui/skeleton';
import { useDialog } from '@/hooks/useDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { chatReducer, initialChatState } from '@/state/chatReducer';
import { ChatActionType } from '@/state/chatTypes';
import { convertThreadMessages } from './messageConverter';

interface LoaderData {
  threadId: string;
  data: Promise<ThreadMessagesResponse>;
}

const CODE_EXECUTION_TOOL_NAME = 'tenjo_execute_code';

function resolveToolCallStatus(event: ToolCallEvent): ChatStatus {
  if (event.type !== 'calling') return null;
  return event.toolName === CODE_EXECUTION_TOOL_NAME
    ? 'executingCode'
    : 'toolExecuting';
}

export function Chat() {
  const { threadId, data } = useLoaderData() as LoaderData;

  return (
    <Suspense key={threadId} fallback={<ChatSkeleton />}>
      <ChatContent threadId={threadId} dataPromise={data} />
    </Suspense>
  );
}

interface ChatContentProps {
  threadId: string;
  dataPromise: Promise<ThreadMessagesResponse>;
}

function ChatContent({ threadId, dataPromise }: ChatContentProps) {
  const {
    messages: initialMessages,
    title: initialTitle,
    pinned: initialPinned,
    isGenerating: initialIsGenerating
  } = use(dataPromise);
  const location = useLocation();
  const { reload } = useHistory();
  const {
    activeModelId,
    enabledTools,
    selectedKnowledge,
    toggleKnowledge,
    executeCodeEnabled,
    webSearchEnabled,
    webSearchExtendedTimeoutEnabled
  } = useSettings();
  const { openDialog } = useDialog();
  const { t } = useTranslation();
  const [{ messages }, dispatch] = useReducer(chatReducer, initialChatState);
  const [chatTitle, setChatTitle] = useState<string>(initialTitle);
  const [chatPinned, setChatPinned] = useState<boolean>(initialPinned);
  const [isGeneratingLocked, setIsGeneratingLocked] =
    useState(initialIsGenerating);
  const hasProcessedInitialMessage = useRef(false);
  const [first, setFirst] = useState<boolean>(true);
  const [chatStatus, setChatStatus] = useState<ChatStatus>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isStreaming = messages.some(msg => msg.isStreaming);
  const isLocked = isStreaming || isGeneratingLocked;

  function scrollToBottom() {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior: 'smooth'
    });
  }

  async function handleStopStreaming() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setChatStatus(null);
    setIsGeneratingLocked(false);
    dispatch({ type: ChatActionType.STOP_STREAMING });
    // Tell the server to abort the generation. SSE close alone no longer
    // cancels — that's what lets the answer survive navigation/reload.
    try {
      await stopGeneration(threadId);
    } catch {
      // UI is already stopped; ignore network failures here.
    }
  }

  // Update state when initialMessages changes.
  useEffect(() => {
    const baseMessages = convertThreadMessages(initialMessages);
    // When the thread is generating in the background (e.g. user navigated
    // away mid-stream and came back), the assistant message isn't in the
    // DB yet. Show a placeholder streaming bubble so the UI matches what
    // the server is doing — the polling effect below will replace it once
    // the assistant message lands.
    const messages = initialIsGenerating
      ? [
          ...baseMessages,
          {
            type: 'assistant' as const,
            content: '',
            isStreaming: true,
            parentMessageId: undefined,
            contentParts: []
          }
        ]
      : baseMessages;
    dispatch({
      type: ChatActionType.SET_MESSAGES,
      payload: messages
    });
    setChatTitle(initialTitle);
    setChatPinned(initialPinned);
    setIsGeneratingLocked(initialIsGenerating);
    hasProcessedInitialMessage.current = false;

    // Scroll to the top when the thread changes.
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'auto' });
    }, 100);
  }, [initialMessages, initialTitle, initialPinned, initialIsGenerating]);

  // Poll for completion when we entered a thread that was already generating
  // server-side. We don't have a live SSE in this case (the original one is
  // owned by a now-unmounted component instance), so just refetch periodically
  // until generation finishes, then swap in the final messages from the DB.
  // For locally-initiated sends initialIsGenerating is false, so this effect
  // doesn't run there.
  useEffect(() => {
    if (!isGeneratingLocked) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const response = await getThreadMessages(threadId);
        if (cancelled) return;
        if (!response.isGenerating) {
          dispatch({
            type: ChatActionType.SET_MESSAGES,
            payload: convertThreadMessages(response.messages)
          });
          setChatTitle(response.title);
          setChatPinned(response.pinned);
          setIsGeneratingLocked(false);
        }
      } catch {
        // Transient errors are fine; the next tick will retry.
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isGeneratingLocked, threadId]);

  // Function to update branch info (only for specified message IDs).
  async function updateBranchStatusForMessages(
    messageIds: (string | undefined)[]
  ) {
    const validIds = messageIds.filter((id): id is string => !!id);
    if (validIds.length === 0) return;

    try {
      const result = await getBranchStatus(threadId, validIds);
      dispatch({
        type: ChatActionType.UPDATE_BRANCH_STATUS,
        payload: result.branchStatuses
      });
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_update_branch_status'),
        type: 'ok'
      });
    }
  }

  // Function to switch branches.
  async function handleSwitchBranch(
    messageId: string,
    direction: 'prev' | 'next'
  ) {
    const message = messages.find(msg => msg.id === messageId);
    if (!message || !message.siblings || !message.currentCount) return;

    const currentIndex = message.currentCount - 1;
    const targetIndex =
      direction === 'prev' ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex < 0 || targetIndex >= message.siblings.length) return;

    const targetSiblingId = message.siblings[targetIndex];

    try {
      const response = await switchBranch(threadId, messageId, targetSiblingId);
      const newMessages = convertThreadMessages(response.messages);
      dispatch({
        type: ChatActionType.SET_MESSAGES,
        payload: newMessages
      });
      setChatTitle(response.title);

      // Scroll to the switched message position
      const switchedIndex = newMessages.findIndex(
        msg => msg.id === targetSiblingId
      );
      if (switchedIndex !== -1) {
        setTimeout(() => {
          virtuosoRef.current?.scrollToIndex({
            index: switchedIndex,
            behavior: 'smooth'
          });
        }, 100);
      }
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_switch_branch'),
        type: 'ok'
      });
    }
  }

  const handlerRef = useRef(handleSendMessage);
  handlerRef.current = handleSendMessage;
  useEffect(() => {
    if (first) {
      setFirst(false);
      return;
    }

    const msg = location.state?.initialMessage as string | undefined;
    const imgUrls = (location.state?.initialImageUrls as string[]) ?? [];
    const hasContent =
      (msg !== undefined && msg !== null) || imgUrls.length > 0;
    // If the message is already included in initialMessages, it has already been sent.
    const isAlreadySent = initialMessages.some(
      m => m.data.content === msg && m.data.role === 'user'
    );

    if (hasContent && !hasProcessedInitialMessage.current && !isAlreadySent) {
      hasProcessedInitialMessage.current = true;
      // Clear location.state so a page reload stops instead of re-sending.
      // Use window.history.replaceState to avoid triggering React Router navigation and loader re-runs.
      window.history.replaceState({}, '', location.pathname);
      handlerRef.current(msg ?? '', imgUrls);
    }
  }, [
    first,
    location.state?.initialMessage,
    location.state?.initialImageUrls,
    location.pathname,
    initialMessages
  ]);

  async function handleRetryUserMessage(messageId: string) {
    // Retrying a user message means editing and resending with the same content.
    const message = messages.find(msg => msg.id === messageId);
    if (!message || message.type !== 'user') return;

    handleEditMessage(messageId, message.content, message.imageUrls);
  }

  async function handleRetryAssistantMessage(messageId: string) {
    // Retrying an assistant message is the same as retrying the parent user message.
    const message = messages.find(msg => msg.id === messageId);
    if (!message || message.type !== 'assistant') return;

    // Find the parent user message.
    const parentMessage = message.parentMessageId
      ? messages.find(m => m.id === message.parentMessageId)
      : undefined;

    if (!parentMessage || parentMessage.type !== 'user' || !parentMessage.id) {
      return;
    }

    // Execute retry of the parent user message.
    handleRetryUserMessage(parentMessage.id);
  }

  async function handleEditMessage(
    messageId: string,
    editedMessage: string,
    imageUrls?: string[]
  ) {
    // Find the index of the message to be edited.
    const editedMessageIndex = messages.findIndex(msg => msg.id === messageId);
    if (editedMessageIndex === -1) return;

    // Save the pre-edit message ID (for updating branch info).
    const originalMessageId = messageId;

    // Remove messages from the edited message onward, then add new messages.
    const editedMessage_parentId =
      messages[editedMessageIndex]?.parentMessageId;

    setChatStatus('processing');
    dispatch({
      type: ChatActionType.REPLACE_OPTIMISTIC_EDIT,
      payload: {
        editIndex: editedMessageIndex,
        editedMessage,
        imageUrls,
        parentMessageId: editedMessage_parentId
      }
    });

    // Scroll to the bottom after adding messages.
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: editedMessageIndex + 1,
        behavior: 'smooth'
      });
    }, 100);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await editAndResendMessage(
        threadId,
        messageId,
        editedMessage,
        {
          signal: abortController.signal,
          onChunk: (chunk: string) => {
            setChatStatus(null);
            dispatch({
              type: ChatActionType.APPEND_CHUNK,
              payload: { chunk }
            });
          },
          onThinking: (chunk: string) => {
            setChatStatus(null);
            dispatch({
              type: ChatActionType.APPEND_THINKING_CHUNK,
              payload: { chunk }
            });
          },
          onReasoning: (chunk: string) => {
            setChatStatus(null);
            dispatch({
              type: ChatActionType.APPEND_THINKING_CHUNK,
              payload: { chunk }
            });
          },
          onProcessing: () => {
            setChatStatus('processing');
          },
          onAnalyzingImages: () => {
            setChatStatus('analyzingImages');
          },
          onComplete: (
            userMessageId?: string,
            assistantMessageId?: string,
            model?: string,
            provider?: string
          ) => {
            abortControllerRef.current = null;
            setChatStatus(null);
            dispatch({
              type: ChatActionType.COMPLETE_STREAMING,
              payload: { userMessageId, assistantMessageId, model, provider }
            });

            // Update branch info after EDIT (executed after IDs are set).
            setTimeout(() => {
              updateBranchStatusForMessages([
                originalMessageId,
                userMessageId,
                assistantMessageId
              ]);
            }, 0);
          },
          onToolCall: (event: ToolCallEvent) => {
            setChatStatus(resolveToolCallStatus(event));
            handleToolCallEvent(event);
          },
          onToolCallStream: (event: ToolCallStreamEvent) => {
            handleToolCallStreamEvent(event);
          },
          onSubAgentActivity: (event: SubAgentActivityEvent) => {
            handleSubAgentActivityEvent(event);
          }
        },
        activeModelId || undefined,
        [...enabledTools],
        imageUrls,
        selectedKnowledge.size > 0 ? [...selectedKnowledge] : undefined,
        executeCodeEnabled,
        webSearchEnabled,
        webSearchExtendedTimeoutEnabled
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Reload messages from server to get correct IDs after abort
        try {
          const response = await getThreadMessages(threadId);
          dispatch({
            type: ChatActionType.SET_MESSAGES,
            payload: convertThreadMessages(response.messages)
          });
        } catch {
          // Ignore reload errors
        }
        return;
      }
      const detail = error instanceof Error ? error.message : undefined;
      openDialog({
        title: t('error'),
        description: detail || t('error_edit_message'),
        type: 'ok'
      });
      // On error, revert messages from the edited message onward.
      dispatch({
        type: ChatActionType.SET_MESSAGES,
        payload: convertThreadMessages(initialMessages)
      });
    } finally {
      abortControllerRef.current = null;
      setChatStatus(null);
    }
  }

  function handleToolCallEvent(event: ToolCallEvent) {
    dispatch({
      type: ChatActionType.UPDATE_TOOL_CALL,
      payload: event
    });
  }

  function handleToolCallStreamEvent(event: ToolCallStreamEvent) {
    dispatch({
      type: ChatActionType.UPDATE_TOOL_CALL_STREAM,
      payload: event
    });
  }

  function handleSubAgentActivityEvent(event: SubAgentActivityEvent) {
    dispatch({
      type: ChatActionType.UPDATE_SUB_AGENT_ACTIVITY,
      payload: event
    });
  }

  async function handleToolApproval(toolCallId: string, approved: boolean) {
    // Immediately update UI: pendingApproval → calling or completed.
    dispatch({
      type: ChatActionType.UPDATE_TOOL_APPROVAL,
      payload: { toolCallId, approved }
    });

    try {
      await approveToolCall(toolCallId, approved);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_tool_approval'),
        type: 'ok'
      });
    }
  }

  async function handleToolAutoApprove(toolCallId: string, toolName: string) {
    // Register an auto-approval rule, then approve.
    try {
      await upsertToolApprovalRule({ toolName, approve: 'auto_approve' });
      await handleToolApproval(toolCallId, true);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_tool_auto_approve'),
        type: 'ok'
      });
    }
  }

  async function handleSendMessage(message: string, imageUrls: string[] = []) {
    const knowledgeIds = [...selectedKnowledge];
    // Get the ID of the last confirmed message (used as parentMessageId).
    const lastCompletedMessage = messages
      .slice()
      .reverse()
      .find(msg => !msg.isStreaming);
    const lastMessageId = lastCompletedMessage?.id;

    // Add a new user message and a streaming assistant message.
    setChatStatus('processing');
    dispatch({
      type: ChatActionType.APPEND_OPTIMISTIC_SEND,
      payload: {
        message,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        parentMessageId: lastMessageId
      }
    });

    // Scroll to the bottom after adding messages.
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: messages.length + 1,
        behavior: 'smooth'
      });
    }, 0);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await sendMessageToThread(
        threadId,
        message,
        lastMessageId,
        {
          signal: abortController.signal,
          onChunk: (chunk: string) => {
            setChatStatus(null);
            dispatch({
              type: ChatActionType.APPEND_CHUNK,
              payload: { chunk }
            });
          },
          onThinking: (chunk: string) => {
            setChatStatus(null);
            dispatch({
              type: ChatActionType.APPEND_THINKING_CHUNK,
              payload: { chunk }
            });
          },
          onReasoning: (chunk: string) => {
            setChatStatus(null);
            dispatch({
              type: ChatActionType.APPEND_THINKING_CHUNK,
              payload: { chunk }
            });
          },
          onProcessing: () => {
            setChatStatus('processing');
          },
          onAnalyzingImages: () => {
            setChatStatus('analyzingImages');
          },
          onGeneratingTitle: () => {
            setChatStatus('generatingTitle');
          },
          onTitle: (title: string) => {
            setChatStatus(null);
            setChatTitle(title);
            reload();
          },
          onComplete: (
            userMessageId?: string,
            assistantMessageId?: string,
            model?: string,
            provider?: string
          ) => {
            abortControllerRef.current = null;
            setChatStatus(null);
            dispatch({
              type: ChatActionType.COMPLETE_STREAMING,
              payload: { userMessageId, assistantMessageId, model, provider }
            });
          },
          onToolCall: (event: ToolCallEvent) => {
            setChatStatus(resolveToolCallStatus(event));
            handleToolCallEvent(event);
          },
          onToolCallStream: (event: ToolCallStreamEvent) => {
            handleToolCallStreamEvent(event);
          },
          onSubAgentActivity: (event: SubAgentActivityEvent) => {
            handleSubAgentActivityEvent(event);
          }
        },
        activeModelId || undefined,
        [...enabledTools],
        imageUrls.length > 0 ? imageUrls : undefined,
        knowledgeIds.length > 0 ? knowledgeIds : undefined,
        executeCodeEnabled,
        webSearchEnabled,
        webSearchExtendedTimeoutEnabled
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Reload messages from server to get correct IDs after abort
        try {
          const response = await getThreadMessages(threadId);
          dispatch({
            type: ChatActionType.SET_MESSAGES,
            payload: convertThreadMessages(response.messages)
          });
        } catch {
          // Ignore reload errors
        }
        return;
      }
      const detail = error instanceof Error ? error.message : undefined;
      openDialog({
        title: t('error'),
        description: detail || t('error_send_message'),
        type: 'ok'
      });
      // On error, remove the last two messages (user and assistant).
      dispatch({ type: ChatActionType.REVERT_SEND });
    } finally {
      abortControllerRef.current = null;
      setChatStatus(null);
    }
  }

  return (
    <MainLayout
      header={
        chatTitle ? (
          <ChatTitleHeader
            threadId={threadId}
            title={chatTitle}
            pinned={chatPinned}
            onTitleChange={setChatTitle}
          />
        ) : (
          <Skeleton className="h-5 w-54" />
        )
      }
      content={
        <Virtuoso
          ref={virtuosoRef}
          style={{ height: '100%' }}
          data={messages}
          followOutput="smooth"
          atBottomStateChange={setIsAtBottom}
          atBottomThreshold={32}
          itemContent={(index, message) => (
            <div className="px-4 py-4 w-full mx-auto md:p-6 md:w-[85%]">
              {message.type === 'user' ? (
                <UserMessageSection
                  message={message.content}
                  imageUrls={message.imageUrls}
                  currentCount={message.currentCount ?? 1}
                  totalCount={message.totalCount ?? 1}
                  isStreaming={isLocked}
                  editing={
                    editingMessageId !== null && editingMessageId === message.id
                  }
                  editValue={editDraft}
                  onEditStart={() => {
                    if (message.id) {
                      setEditingMessageId(message.id);
                      setEditDraft(message.content);
                    }
                  }}
                  onEditChange={setEditDraft}
                  onEditCancel={() => setEditingMessageId(null)}
                  onSave={(editedMessage: string) => {
                    if (message.id) {
                      setEditingMessageId(null);
                      handleEditMessage(
                        message.id,
                        editedMessage,
                        message.imageUrls
                      );
                    }
                  }}
                  onRetry={() => {
                    if (message.id) {
                      handleRetryUserMessage(message.id);
                    }
                  }}
                  onPrevious={() => {
                    if (message.id) {
                      handleSwitchBranch(message.id, 'prev');
                    }
                  }}
                  onNext={() => {
                    if (message.id) {
                      handleSwitchBranch(message.id, 'next');
                    }
                  }}
                />
              ) : (
                <>
                  {(() => {
                    const hasContent = !!message.content;
                    const hasThinking = !!message.thinkingContent;
                    const hasToolCalls = !!message.toolCalls?.length;
                    const hasSubAgentActivity =
                      !!message.subAgentActivities?.length;
                    if (
                      !hasContent &&
                      !hasThinking &&
                      !hasToolCalls &&
                      !hasSubAgentActivity
                    )
                      return null;

                    // Find the parent (user message) of this assistant message.
                    const parentMessage = message.parentMessageId
                      ? messages.find(m => m.id === message.parentMessageId)
                      : undefined;

                    return (
                      <AssistantMessageSection
                        message={message.content}
                        messageId={message.id}
                        thinkingContent={message.thinkingContent}
                        modelName={message.model}
                        providerType={message.provider}
                        currentCount={parentMessage?.currentCount ?? 1}
                        totalCount={parentMessage?.totalCount ?? 1}
                        isStreaming={isLocked || message.isStreaming}
                        contentParts={message.contentParts}
                        subAgentActivities={message.subAgentActivities}
                        toolCalls={message.toolCalls?.map(tc =>
                          tc.status === 'pendingApproval'
                            ? {
                                ...tc,
                                onApprove: () =>
                                  handleToolApproval(tc.toolCallId, true),
                                onReject: () =>
                                  handleToolApproval(tc.toolCallId, false),
                                onAutoApprove: () =>
                                  handleToolAutoApprove(
                                    tc.toolCallId,
                                    tc.toolName
                                  )
                              }
                            : tc
                        )}
                        onRetry={() => {
                          if (message.id) {
                            handleRetryAssistantMessage(message.id);
                          }
                        }}
                        onPrevious={() => {
                          if (parentMessage?.id) {
                            handleSwitchBranch(parentMessage.id, 'prev');
                          }
                        }}
                        onNext={() => {
                          if (parentMessage?.id) {
                            handleSwitchBranch(parentMessage.id, 'next');
                          }
                        }}
                      />
                    );
                  })()}
                  {index === messages.length - 1 &&
                    (chatStatus || message.isStreaming) && (
                      <ChatStatusLine status={chatStatus ?? 'processing'} />
                    )}
                </>
              )}
            </div>
          )}
        />
      }
      footer={
        <div className="relative bg-background">
          {!isAtBottom && messages.length > 0 && (
            <div className="pointer-events-none absolute -top-12 left-0 right-0 flex justify-center">
              <ScrollToBottomButton
                onClick={scrollToBottom}
                className="pointer-events-auto"
              />
            </div>
          )}
          <div className="px-4 py-4 w-full mx-auto md:p-6 md:w-[85%]">
            <ChatInput
              onSendMessage={handleSendMessage}
              uploadImageFile={(file, onProgress) =>
                uploadImage(threadId, file, onProgress)
              }
              isStreaming={isLocked}
              isGeneratingLocked={isGeneratingLocked}
              onStop={handleStopStreaming}
              selectedKnowledge={selectedKnowledge}
              onToggleKnowledge={toggleKnowledge}
            />
          </div>
        </div>
      }
    />
  );
}
