import { useParams, useLocation, useNavigate } from 'react-router';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent
} from 'react';
import { FolderOpen, Loader2, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { MainLayout } from '../../layout';
import { AgentProvider, useAgent } from '@/contexts/agent-context';
import { AgentPromptInput } from '@/components/agent/agent-prompt-input';
import { AgentPlanCard } from '@/components/agent/agent-plan-card';
import { AgentToolCard } from '@/components/agent/agent-tool-call';
import { WebSearchToolCall } from '@/components/chat/web-search-tool-call';
import type { ToolCallInfo } from '@/components/chat/tool-call-section';
import type { SubAgentActivityInfo } from '@/components/chat/sub-agent-activity';
import { AgentMessageQueue } from '@/components/agent/agent-message-queue';
import { AgentTaskTitleHeader } from '@/components/agent/agent-task-title-header';
import { AgentSandboxBanner } from '@/components/agent/agent-sandbox-banner';
import { AgentGuiPanel } from '@/components/agent/agent-gui-panel';
import { FileManager } from '@/components/agent/file-manager';
import {
  FilePreviewDialog,
  type PreviewFile
} from '@/components/agent/file-preview-dialog';
import { UserMessage } from '@/components/chat/user-message';
import { AssistantMessage } from '@/components/chat/assistant-message';
import { ThinkingBlock } from '@/components/chat/thinking-block';
import { ScrollToBottomButton } from '@/components/chat/scroll-to-bottom-button';
import { cn } from '@/lib/utils';
import { prettifyContextDir } from '@/lib/contextPath';
import {
  createAgentFileLinkResolver,
  type FileLinkResolver
} from '@/lib/agentFileLinks';
import {
  formatAgentProjectModelLabel,
  formatProviderLabel
} from '@/lib/providerLabels';
import type { AgentFileKind, AgentMode } from '@/components/agent/types';
import type { ContextFileRef } from '@/api/server/agent';
import type {
  AgentChatMessage,
  PendingToolApproval,
  PendingAgentQuestion
} from '@/contexts/agent-reducer';
import { AgentQuestionCard } from '@/components/agent/agent-question-card';
import { useAgentHistory } from '@/contexts/agent-history-context';
import { useSettings } from '@/contexts/settings-context';
import { useTranslation } from '@/hooks/useTranslation';
import { useResizableSplit } from '@/hooks/useResizableSplit';

const STREAMING_ID = '__streaming__';
const AGENT_PANEL_BREAKPOINT = 1024;

function useIsNarrowAgentLayout() {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(max-width: ${AGENT_PANEL_BREAKPOINT - 1}px)`
    );
    const sync = () => setIsNarrow(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  return isNarrow;
}

function hasVisibleText(text: string): boolean {
  return text.trim().length > 0;
}

const PLAN_TOOLS = new Set(['present_plan', 'update_plan']);

function isCompactToolRow(message: AgentChatMessage): boolean {
  if (message.role === 'tool') {
    return true;
  }
  if (message.role !== 'assistant' || message.content || message.thinking) {
    return false;
  }
  const toolCalls = message.toolCalls?.filter(
    call => !PLAN_TOOLS.has(call.name)
  );
  return (toolCalls?.length ?? 0) > 0;
}

const BROWSER_DELEGATE_TOOL_NAME = 'tenjo_browser_agent';
const ASK_USER_QUESTION_TOOL_NAME = 'ask_user_question';

function parseQuestionAnswer(result: string): string | null {
  try {
    const parsed = JSON.parse(result) as { answer?: unknown };
    return typeof parsed.answer === 'string' ? parsed.answer : null;
  } catch {
    return null;
  }
}

function parseBrowserResult(result: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(result);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function MessageRow({
  message,
  toolResults,
  toolApprovals,
  pendingQuestions,
  subAgentActivities,
  onApproveTool,
  onAutoApproveTool,
  onAnswerQuestion,
  isBusy,
  resolveFileLink,
  onOpenLocalUrl
}: {
  message: AgentChatMessage;
  toolResults: Map<string, string>;
  toolApprovals: Map<string, PendingToolApproval>;
  pendingQuestions: Map<string, PendingAgentQuestion>;
  subAgentActivities: SubAgentActivityInfo[];
  onApproveTool: (toolCallId: string, approved: boolean) => void;
  onAutoApproveTool: (toolCallId: string, toolName: string) => void;
  onAnswerQuestion: (questionId: string, answer: string) => void;
  isBusy: boolean;
  resolveFileLink: FileLinkResolver;
  onOpenLocalUrl: (url: string) => void;
}) {
  const { t } = useTranslation();
  const label = t('agent_context_files');
  const content = prettifyContextDir(message.content, label);
  const thinking = message.thinking
    ? prettifyContextDir(message.thinking, label)
    : message.thinking;

  if (message.role === 'user') {
    return <UserMessage>{content}</UserMessage>;
  }
  if (message.role === 'tool') {
    return null;
  }
  const toolCalls = (message.toolCalls ?? []).filter(
    call => !PLAN_TOOLS.has(call.name)
  );
  return (
    <>
      {thinking && <ThinkingBlock content={thinking} />}
      {content && (
        <AssistantMessage
          messageId={message.id}
          resolveFileLink={resolveFileLink}
          onOpenLocalUrl={onOpenLocalUrl}
        >
          {content}
        </AssistantMessage>
      )}
      {toolCalls.map(call => {
        const result = toolResults.get(call.id);
        const awaitingApproval = toolApprovals.has(call.id);
        const pending = result === undefined && isBusy;
        if (call.name === ASK_USER_QUESTION_TOOL_NAME) {
          const question = pendingQuestions.get(call.id);
          if (question) {
            return (
              <AgentQuestionCard
                key={call.id}
                question={question.question}
                header={question.header}
                options={question.options}
                multiSelect={question.multiSelect}
                onSubmit={answer => onAnswerQuestion(call.id, answer)}
              />
            );
          }
          let parsedArgs: {
            question?: unknown;
            options?: unknown;
            multiSelect?: unknown;
            header?: unknown;
          } = {};
          try {
            parsedArgs = JSON.parse(call.args);
          } catch {
            parsedArgs = {};
          }
          return (
            <AgentQuestionCard
              key={call.id}
              question={
                typeof parsedArgs.question === 'string'
                  ? parsedArgs.question
                  : ''
              }
              header={
                typeof parsedArgs.header === 'string'
                  ? parsedArgs.header
                  : undefined
              }
              options={[]}
              multiSelect={parsedArgs.multiSelect === true}
              resolved
              answer={
                result !== undefined
                  ? (parseQuestionAnswer(result) ?? undefined)
                  : undefined
              }
            />
          );
        }
        if (call.name === BROWSER_DELEGATE_TOOL_NAME && !awaitingApproval) {
          const parsed =
            result === undefined ? null : parseBrowserResult(result);
          if (pending || parsed) {
            const toolCall: ToolCallInfo = {
              toolCallId: call.id,
              toolName: call.name,
              result: parsed ?? undefined,
              success: parsed ? !parsed.error : false,
              status: pending ? 'calling' : 'completed'
            };
            return (
              <WebSearchToolCall
                key={call.id}
                toolCall={toolCall}
                activities={subAgentActivities}
              />
            );
          }
        }
        return (
          <AgentToolCard
            key={call.id}
            name={call.name}
            args={call.args}
            result={result}
            pending={pending}
            approvalPending={awaitingApproval}
            onApprove={() => onApproveTool(call.id, true)}
            onReject={() => onApproveTool(call.id, false)}
            onAutoApprove={() => onAutoApproveTool(call.id, call.name)}
          />
        );
      })}
    </>
  );
}

function AgentWorkspace({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    state,
    submit,
    submitting,
    approve,
    reject,
    approveTool,
    autoApproveTool,
    answerQuestion,
    removeFromQueue,
    removeContextFile,
    stop,
    openGuiPreview
  } = useAgent();
  const { reload: reloadHistory } = useAgentHistory();
  const { models, isLoaded: settingsLoaded, reloadModels } = useSettings();
  const isNarrowLayout = useIsNarrowAgentLayout();

  const navState = location.state as {
    initialPrompt?: string;
    initialMode?: AgentMode;
    initialContextFiles?: ContextFileRef[];
    initialKnowledgeIds?: string[];
    initialImagePreviews?: string[];
  } | null;
  const initialPrompt = navState?.initialPrompt ?? '';
  const initialMode = navState?.initialMode ?? null;
  const initialContextFiles = navState?.initialContextFiles;
  const initialKnowledgeIds = navState?.initialKnowledgeIds;
  const initialImagePreviews = navState?.initialImagePreviews;

  const historyReloaded = useRef(false);
  useEffect(() => {
    if (historyReloaded.current) return;
    historyReloaded.current = true;
    void reloadHistory();
  }, [reloadHistory]);

  const modelsReloaded = useRef(false);
  useEffect(() => {
    if (modelsReloaded.current) return;
    modelsReloaded.current = true;
    void reloadModels();
  }, [reloadModels]);

  const syncedTitle = useRef<string | null>(null);
  useEffect(() => {
    if (
      state.title &&
      state.title !== '-' &&
      syncedTitle.current !== state.title
    ) {
      syncedTitle.current = state.title;
      void reloadHistory();
    }
  }, [state.title, reloadHistory]);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const followRef = useRef(true);
  const handleAtBottomChange = (atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    if (atBottom) followRef.current = true;
  };
  const handleWheel = (event: React.WheelEvent) => {
    if (event.deltaY < 0) followRef.current = false;
  };
  const lastScrollTopByElementRef = useRef(new WeakMap<HTMLElement, number>());
  const handleScrollCapture = (event: UIEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const scrollTop = target.scrollTop;
    const lastScrollTop = lastScrollTopByElementRef.current.get(target) ?? 0;
    if (scrollTop < lastScrollTop) {
      followRef.current = false;
    }
    lastScrollTopByElementRef.current.set(target, scrollTop);
  };
  const [mode, setMode] = useState<AgentMode>(initialMode ?? 'plan');
  const [optimistic, setOptimistic] = useState<{
    text: string;
    images: string[];
  } | null>(null);
  const optimisticBaseline = useRef(0);

  useEffect(() => {
    setMode(state.mode);
  }, [state.mode]);

  useEffect(() => {
    if (!optimistic) {
      return;
    }
    if (
      state.messages.length > optimisticBaseline.current ||
      state.streaming ||
      state.status === 'failed'
    ) {
      optimistic.images.forEach(url => URL.revokeObjectURL(url));
      setOptimistic(null);
    }
  }, [state.messages.length, state.streaming, state.status, optimistic]);

  const promptSent = useRef(false);
  useEffect(() => {
    if (promptSent.current) return;
    if (!initialPrompt) return;
    if (state.connection !== 'open') return;
    promptSent.current = true;
    optimisticBaseline.current = 0;
    setOptimistic({ text: initialPrompt, images: initialImagePreviews ?? [] });
    void navigate(location.pathname, { replace: true });
    void submit(
      initialPrompt,
      initialMode ?? mode,
      [],
      initialContextFiles,
      initialKnowledgeIds
    );
  }, [
    state.connection,
    initialPrompt,
    initialMode,
    initialContextFiles,
    initialKnowledgeIds,
    initialImagePreviews,
    submit,
    mode,
    navigate,
    location.pathname
  ]);

  const { containerRef, percent, isDragging, separatorProps } =
    useResizableSplit({
      side: 'right',
      initialPercent: 40,
      minPercent: 20,
      maxPercent: 70
    });

  const scrollToBottomOnce = (behavior: 'auto' | 'smooth') => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior
    });
  };

  const scrollToBottom = () => {
    followRef.current = true;
    scrollToBottomOnce('auto');
    requestAnimationFrame(() => scrollToBottomOnce('auto'));
    window.setTimeout(() => scrollToBottomOnce('auto'), 50);
    window.setTimeout(() => scrollToBottomOnce('auto'), 150);
  };

  const visibleMessages = state.messages.filter(
    message => message.role !== 'tool'
  );
  const items: AgentChatMessage[] = state.streaming
    ? [
        ...visibleMessages,
        {
          id: STREAMING_ID,
          role: 'assistant',
          content: state.streaming.content,
          thinking: hasVisibleText(state.streaming.thinking)
            ? state.streaming.thinking
            : undefined
        }
      ]
    : visibleMessages;

  const isBusy = state.status === 'running' || state.streaming !== null;
  const isPreparing = optimistic !== null && items.length === 0;

  const scrollSignature = [
    state.messages.length,
    state.streaming?.content.length ?? 0,
    state.streaming?.thinking.length ?? 0,
    state.planFlow.length,
    state.plan?.status ?? '',
    state.pendingApprovals.length
  ].join(':');
  useEffect(() => {
    if (!followRef.current && !isAtBottomRef.current) return;
    scrollToBottomOnce('auto');
  }, [scrollSignature]);

  const [panelTab, setPanelTab] = useState<'files' | 'gui'>('files');
  const [mobileFilesOpen, setMobileFilesOpen] = useState(false);
  const [mobileGuiOpen, setMobileGuiOpen] = useState(false);

  const guiNeeded =
    state.previewAvailable ||
    state.guiStatus.status === 'starting' ||
    state.guiStatus.status === 'running' ||
    state.guiStatus.status === 'stopping';

  useEffect(() => {
    if (!guiNeeded && panelTab === 'gui') {
      setPanelTab('files');
    }
  }, [guiNeeded, panelTab]);

  const autoLaunchSeqSeen = useRef(0);
  const [autoPreviewPending, setAutoPreviewPending] = useState(false);
  useEffect(() => {
    if (state.autoPreviewLaunchSeq === autoLaunchSeqSeen.current) {
      return;
    }
    autoLaunchSeqSeen.current = state.autoPreviewLaunchSeq;
    setAutoPreviewPending(true);
  }, [state.autoPreviewLaunchSeq]);
  useEffect(() => {
    if (!autoPreviewPending || isBusy) {
      return;
    }
    setAutoPreviewPending(false);
    if (isNarrowLayout) {
      setMobileGuiOpen(true);
    } else {
      setPanelTab('gui');
    }
    openGuiPreview();
  }, [autoPreviewPending, isBusy, isNarrowLayout, openGuiPreview]);

  const openLocalUrl = (url: string) => {
    if (isNarrowLayout) {
      setMobileGuiOpen(true);
    } else {
      setPanelTab('gui');
    }
    openGuiPreview(url);
  };

  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const openPreview = (path: string, name: string, kind: AgentFileKind) =>
    setPreviewFile({ path, name, kind });

  const resolveFileLink = createAgentFileLinkResolver(
    projectId,
    state.fileTree,
    openPreview
  );

  const toolResults = new Map<string, string>();
  for (const message of state.messages) {
    if (message.role === 'tool' && message.toolResult) {
      toolResults.set(
        message.toolResult.toolCallId,
        message.toolResult.content
      );
    }
  }

  const toolApprovals = new Map(
    state.pendingApprovals.map(approval => [approval.toolCallId, approval])
  );
  const renderedCallIds = new Set(
    state.messages.flatMap(message =>
      (message.toolCalls ?? []).map(call => call.id)
    )
  );
  const orphanApprovals = state.pendingApprovals.filter(
    approval => !renderedCallIds.has(approval.toolCallId)
  );

  const pendingQuestions = new Map(
    state.pendingQuestions.map(question => [question.questionId, question])
  );
  const orphanQuestions = state.pendingQuestions.filter(
    question => !renderedCallIds.has(question.questionId)
  );

  const itemIds = new Set(items.map(item => item.id));
  const lastItemId = items.length > 0 ? items[items.length - 1].id : null;
  const planFlowByAnchor = new Map<string, typeof state.planFlow>();
  for (const entry of state.planFlow) {
    const target =
      entry.afterMessageId && itemIds.has(entry.afterMessageId)
        ? entry.afterMessageId
        : lastItemId;
    if (!target) {
      continue;
    }
    const list = planFlowByAnchor.get(target) ?? [];
    list.push(entry);
    planFlowByAnchor.set(target, list);
  }

  const handleSubmit = (
    value: string,
    files: File[],
    contextFiles: ContextFileRef[],
    knowledgeIds: string[]
  ) => {
    const willQueue = isBusy || submitting;
    if (!willQueue) {
      const images = files
        .filter(file => file.type.startsWith('image/'))
        .map(file => URL.createObjectURL(file));
      optimisticBaseline.current = state.messages.length;
      setOptimistic({ text: value, images });
    }
    void submit(value, mode, [], contextFiles, knowledgeIds);
  };

  const planAnchorId =
    state.plan != null
      ? ([...state.messages]
          .reverse()
          .find(message =>
            message.toolCalls?.some(call => call.name === 'present_plan')
          )?.id ?? null)
      : null;

  const planCard = state.plan ? (
    <AgentPlanCard plan={state.plan} onApprove={approve} onReject={reject} />
  ) : null;

  const renderOptimistic = (value: { text: string; images: string[] }) => (
    <>
      {value.images.length > 0 && (
        <div className="mb-2 flex flex-wrap justify-end gap-1.5">
          {value.images.map(url => (
            <img
              key={url}
              src={url}
              alt=""
              className="h-20 w-20 rounded-md border border-border object-cover"
            />
          ))}
        </div>
      )}
      {value.text && <UserMessage>{value.text}</UserMessage>}
    </>
  );

  const Footer = () => {
    const footerPlanCard = planCard && planAnchorId === null ? planCard : null;
    const showOptimistic = optimistic !== null && items.length > 0;
    if (
      !footerPlanCard &&
      orphanApprovals.length === 0 &&
      orphanQuestions.length === 0 &&
      !showOptimistic
    ) {
      return null;
    }
    return (
      <div className="w-full mx-auto px-4 pb-2 md:px-6 md:w-[90%]">
        {orphanQuestions.map(question => (
          <AgentQuestionCard
            key={question.questionId}
            question={question.question}
            header={question.header}
            options={question.options}
            multiSelect={question.multiSelect}
            onSubmit={answer => answerQuestion(question.questionId, answer)}
          />
        ))}
        {orphanApprovals.map(approval => (
          <AgentToolCard
            key={approval.toolCallId}
            name={approval.toolName}
            args={approval.args}
            pending
            approvalPending
            onApprove={() => approveTool(approval.toolCallId, true)}
            onReject={() => approveTool(approval.toolCallId, false)}
            onAutoApprove={() =>
              autoApproveTool(approval.toolCallId, approval.toolName)
            }
          />
        ))}
        {footerPlanCard}
        {showOptimistic && optimistic && (
          <div className="pt-4">{renderOptimistic(optimistic)}</div>
        )}
      </div>
    );
  };

  const showWaiting =
    (isBusy || submitting) &&
    !isPreparing &&
    state.plan?.status !== 'proposed' &&
    state.pendingQuestions.length === 0;
  const guiPreviewRunning = state.guiStatus.status === 'running';
  const guiPreviewLaunchDisabled =
    !guiPreviewRunning &&
    (isBusy ||
      state.previewRepairActive ||
      state.guiStatus.status === 'starting' ||
      state.guiStatus.status === 'stopping');
  const lockedModelDeleted =
    state.agentModel !== null &&
    settingsLoaded &&
    !models.some(
      model =>
        model.id === state.agentModel?.id ||
        (model.type === state.agentModel?.provider &&
          model.model === state.agentModel.model &&
          model.baseUrl === state.agentModel.baseUrl)
    );
  const lockedModelLabel = state.agentModel
    ? lockedModelDeleted
      ? `${t('agent_model_deleted_suffix')}: ${formatProviderLabel(
          state.agentModel.provider
        )} / ${state.agentModel.model}`
      : formatAgentProjectModelLabel(state.agentModel)
    : undefined;
  const modelVerificationPending = state.agentModel !== null && !settingsLoaded;
  const promptDisabled =
    state.sandboxStatus.status === 'unavailable' ||
    lockedModelDeleted ||
    modelVerificationPending;
  const promptDisabledHint = lockedModelDeleted
    ? t('agent_model_deleted_description')
    : modelVerificationPending
      ? t('agent_model_loading')
      : t('agent_sandbox_unavailable_description');

  const openMobileGui = () => {
    setMobileGuiOpen(true);
    if (!guiPreviewRunning) {
      openGuiPreview();
    }
  };

  const fileManager = (
    <FileManager
      files={state.fileTree}
      contextFiles={state.contextFiles}
      projectId={projectId}
      highlights={state.highlights}
      loading={
        !state.fileTreeLoaded && state.sandboxStatus.status !== 'unavailable'
      }
      onDeleteContextFile={removeContextFile}
      onPreview={openPreview}
    />
  );

  const EmptyPlaceholder = () => {
    if (state.connection !== 'open' && items.length === 0) {
      return (
        <div className="flex h-full min-h-[45vh] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span>
            {state.connection === 'connecting'
              ? t('agent_loading')
              : t('agent_connection_closed')}
          </span>
        </div>
      );
    }

    if (!isPreparing && items.length === 0) {
      return (
        <div className="flex h-full min-h-[45vh] flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {t('agent_empty_task')}
        </div>
      );
    }

    return isPreparing && optimistic ? (
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto w-full md:w-[90%]">
          {renderOptimistic(optimistic)}
        </div>
        <div className="mx-auto flex w-full items-center gap-2 text-sm text-muted-foreground md:w-[90%]">
          <Loader2 className="size-4 animate-spin" />
          <span>{t('agent_preparing')}</span>
        </div>
      </div>
    ) : null;
  };

  return (
    <MainLayout
      header={
        <AgentTaskTitleHeader
          projectId={projectId}
          title={state.title || projectId}
        />
      }
      content={
        <div
          ref={containerRef}
          className={`flex h-full min-h-0 flex-col lg:flex-row ${
            isDragging ? 'cursor-col-resize select-none' : ''
          }`}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b lg:border-b-0">
            {(state.sandboxStatus.status === 'preparing' ||
              state.sandboxStatus.status === 'unavailable') && (
              <div className="px-4 pt-4 md:px-6">
                <div className="mx-auto w-full md:w-[90%]">
                  <AgentSandboxBanner sandboxStatus={state.sandboxStatus} />
                </div>
              </div>
            )}
            <div
              className="min-h-0 flex-1"
              onScrollCapture={handleScrollCapture}
              onWheel={handleWheel}
            >
              <Virtuoso
                ref={virtuosoRef}
                style={{ height: '100%' }}
                data={items}
                atBottomStateChange={handleAtBottomChange}
                atBottomThreshold={32}
                components={{ Footer, EmptyPlaceholder }}
                itemContent={(_index, message) => (
                  <div
                    className={cn(
                      'w-full mx-auto px-4 md:px-6 md:w-[90%]',
                      isCompactToolRow(message) ? 'py-0.5' : 'py-4 md:py-6'
                    )}
                  >
                    <MessageRow
                      message={message}
                      toolResults={toolResults}
                      toolApprovals={toolApprovals}
                      pendingQuestions={pendingQuestions}
                      subAgentActivities={state.subAgentActivities}
                      onApproveTool={approveTool}
                      onAutoApproveTool={autoApproveTool}
                      onAnswerQuestion={answerQuestion}
                      isBusy={isBusy}
                      resolveFileLink={resolveFileLink}
                      onOpenLocalUrl={openLocalUrl}
                    />
                    {planFlowByAnchor.get(message.id)?.map(entry => (
                      <AgentPlanCard
                        key={entry.id}
                        plan={entry.plan}
                        live={false}
                      />
                    ))}
                    {planCard && message.id === planAnchorId && (
                      <div className="pt-3">{planCard}</div>
                    )}
                  </div>
                )}
              />
            </div>
            <div className="relative bg-background">
              {!isAtBottom && items.length > 0 && (
                <div className="pointer-events-none absolute -top-12 left-0 right-0 flex justify-center">
                  <ScrollToBottomButton
                    onClick={scrollToBottom}
                    className="pointer-events-auto"
                  />
                </div>
              )}
              {showWaiting && (
                <p
                  className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground"
                  data-testid="agent-processing-wait"
                >
                  <Loader2 className="size-4 animate-spin" />
                  <span>{t('agent_processing_wait')}</span>
                </p>
              )}
              <div className="border-t px-4 py-4 md:px-6 md:py-6">
                <div className="mb-3 flex justify-center gap-2 lg:hidden">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="agent-mobile-files-open"
                    onClick={() => setMobileFilesOpen(true)}
                  >
                    <FolderOpen className="size-4" />
                    {t('agent_files')}
                  </Button>
                  {(state.previewAvailable || guiNeeded) && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="agent-mobile-gui-open"
                      disabled={guiPreviewLaunchDisabled}
                      onClick={openMobileGui}
                    >
                      <Monitor className="size-4" />
                      {guiPreviewRunning
                        ? t('agent_gui_tab')
                        : t('agent_gui_launch_app')}
                    </Button>
                  )}
                </div>
                {state.previewAvailable && (
                  <div className="mb-3 hidden justify-center lg:flex">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="agent-gui-launch-app"
                      disabled={guiPreviewLaunchDisabled}
                      onClick={() => {
                        setPanelTab('gui');
                        if (!guiPreviewRunning) {
                          openGuiPreview();
                        }
                      }}
                    >
                      <Monitor className="size-4" />
                      {guiPreviewRunning
                        ? t('agent_gui_tab')
                        : t('agent_gui_launch_app')}
                    </Button>
                  </div>
                )}
                <AgentMessageQueue
                  items={state.queue}
                  onRemove={removeFromQueue}
                />
                <AgentPromptInput
                  placeholderKey="agent_followup_placeholder"
                  onSubmit={handleSubmit}
                  mode={mode}
                  onModeChange={setMode}
                  isBusy={isBusy}
                  onStop={stop}
                  disabled={promptDisabled}
                  disabledHint={promptDisabledHint}
                  modelLocked
                  lockedModelLabel={lockedModelLabel}
                />
              </div>
            </div>
          </div>

          <div
            {...separatorProps}
            className="hidden lg:block w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors touch-none"
          />

          <div
            className="hidden w-full shrink-0 flex-col overflow-hidden bg-muted/20 p-5 lg:flex lg:w-[var(--fm-width)]"
            style={{ '--fm-width': `${percent}%` } as CSSProperties}
          >
            <div className="mb-3 flex items-center gap-4 text-xs font-semibold uppercase tracking-wide">
              <button
                type="button"
                onClick={() => setPanelTab('files')}
                data-testid="agent-panel-tab-files"
                className={cn(
                  'transition-colors',
                  panelTab === 'files'
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('agent_files')}
              </button>
              {guiNeeded && (
                <button
                  type="button"
                  onClick={() => setPanelTab('gui')}
                  data-testid="agent-panel-tab-gui"
                  className={cn(
                    'flex items-center gap-1.5 transition-colors',
                    panelTab === 'gui'
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t('agent_gui_tab')}
                  {state.guiStatus.status === 'running' && (
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                  )}
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1">
              {panelTab === 'files' ? (
                fileManager
              ) : (
                <AgentGuiPanel projectId={projectId} />
              )}
            </div>
          </div>

          <Dialog open={mobileFilesOpen} onOpenChange={setMobileFilesOpen}>
            <DialogContent
              className="flex h-[min(88vh,100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 p-0 sm:max-w-xl lg:hidden"
              aria-describedby={undefined}
              data-testid="agent-mobile-files-dialog"
            >
              <DialogHeader className="border-b px-4 py-3 pr-12 text-left">
                <DialogTitle className="text-sm font-medium">
                  {t('agent_files')}
                </DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 p-3">{fileManager}</div>
            </DialogContent>
          </Dialog>

          <Dialog open={mobileGuiOpen} onOpenChange={setMobileGuiOpen}>
            <DialogContent
              className="flex h-[min(88vh,100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 p-0 sm:max-w-xl lg:hidden"
              aria-describedby={undefined}
              data-testid="agent-mobile-gui-dialog"
            >
              <DialogHeader className="border-b px-4 py-3 pr-12 text-left">
                <DialogTitle className="text-sm font-medium">
                  {t('agent_gui_tab')}
                </DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 p-3">
                <AgentGuiPanel projectId={projectId} />
              </div>
            </DialogContent>
          </Dialog>

          <FilePreviewDialog
            projectId={projectId}
            file={previewFile}
            onClose={() => setPreviewFile(null)}
          />
        </div>
      }
    />
  );
}

export function AgentTaskPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return null;
  }
  return (
    <AgentProvider key={id} projectId={id}>
      <AgentWorkspace projectId={id} />
    </AgentProvider>
  );
}
