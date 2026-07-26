import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useSettings } from '@/contexts/settings-context';
import { useDialog } from '@/hooks/useDialog';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getAgentProject,
  useAgentEvents,
  submitAgentMessage,
  decideAgentPlan,
  abortAgent,
  approveAgentToolCall,
  answerAgentQuestion,
  removeAgentQueueItem,
  uploadContextFile,
  deleteAgentContextFile,
  openAgentGui,
  stopAgentGui,
  type AgentServerEvent,
  type ContextFileRef
} from '@/api/server/agent';
import { ApiError } from '@/api/errors/ApiError';
import { upsertToolApprovalRule } from '@/api/server/settings';
import type { AgentMode } from '@/components/agent/types';
import {
  agentReducer,
  initialAgentState,
  isInternalPlanStep,
  mapMessageView,
  mapPlanTodosToSteps,
  mapQueue,
  type AgentState,
  type FileHighlight
} from './agent-reducer';

interface AgentContextValue {
  state: AgentState;
  /** True when GET /projects/:id returned 404. */
  notFound: boolean;
  submit: (
    text: string,
    mode: AgentMode,
    files: File[],
    preUploaded?: ContextFileRef[],
    knowledgeIds?: string[]
  ) => Promise<void>;
  /*
   * True from submit until the server accepts it. Covers the silent server-side
   * image-description gap before the turn starts.
   */
  submitting: boolean;
  approve: () => void;
  reject: (feedback?: string) => void;
  // Approve or reject a pending MCP tool call.
  approveTool: (toolCallId: string, approved: boolean) => void;
  // Register an auto-approval rule for the tool, then approve.
  autoApproveTool: (toolCallId: string, toolName: string) => void;
  // Answer a pending ask_user_question.
  answerQuestion: (questionId: string, answer: string) => void;
  removeFromQueue: (id: string) => void;
  // Delete an uploaded context file after confirmation.
  removeContextFile: (path: string, name: string) => void;
  stop: () => void;
  // Open the GUI preview and ensure the recorded dev server runs.
  openGuiPreview: (url?: string) => void;
  // Stop the GUI preview sidecar.
  stopGui: () => void;
  // Ask the agent to fix a failed preview launch.
  fixPreview: () => void;
  // Dismiss the preview launch-failure notice without asking for a fix.
  dismissPreviewError: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

// How long a file-tree highlight glows before settling / the node is removed.
const HIGHLIGHT_MS: Record<FileHighlight, number> = {
  added: 1500,
  edited: 1500,
  deleted: 900
};

export function AgentProvider({
  projectId,
  children
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { openDialog, closeDialog } = useDialog();
  const { webSearchEnabled, webSearchExtendedTimeoutEnabled } = useSettings();
  const [state, dispatch] = useReducer(agentReducer, initialAgentState);
  /*
   * Covers the submit→accept gap (image describe runs server-side before the
   * turn starts); see the AgentContextValue.submitting doc.
   */
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const highlightTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  /*
   * The REST snapshot reads the persisted queue, whose "item left the queue"
   * write is async, so it can be staler than a live queue-changed event.
   */
  const queueEventSeen = useRef(false);
  /*
   * Auto-submit one fix turn per distinct preview error, but leave the manual
   * button for repeated failures so a broken app cannot loop forever.
   */
  const autoFixedPreviewError = useRef<string | null>(null);
  /*
   * A preview-fix turn may rebuild without touching the preview manifest. In
   * that case the client reopens the preview once the repair turn completes.
   */
  const previewRepairPending = useRef(false);
  const previewRepairSawTurn = useRef(false);
  const previewRepairRequestedLaunch = useRef(false);
  const previewRepairAwaitingLaunch = useRef(false);

  const handleEvent = (event: AgentServerEvent): void => {
    switch (event.type) {
      case 'message-added':
        dispatch({
          type: 'message-added',
          message: mapMessageView(event.message)
        });
        break;
      case 'chunk':
        dispatch({ type: 'chunk', text: event.text });
        break;
      case 'thinking':
      case 'reasoning':
        dispatch({ type: 'thinking', text: event.text });
        break;
      case 'status':
        // ChatClient stream status ('message'/'tool_call'/'done'...), not the
        // project status. Folding it into state.status used to clobber
        // 'running' mid-turn, which hid the stop button while a tool (for example a
        // long bash command) was executing without any LLM stream open.
        break;
      case 'project-status':
        dispatch({ type: 'status', status: event.status });
        break;
      case 'sandbox-status':
        dispatch({
          type: 'sandbox-status',
          sandboxStatus: { status: event.status, detail: event.detail }
        });
        break;
      case 'gui-status':
        dispatch({
          type: 'gui-status',
          guiStatus: { status: event.status, detail: event.detail }
        });
        if (
          previewRepairAwaitingLaunch.current &&
          (event.status === 'running' ||
            event.status === 'error' ||
            event.status === 'stopped')
        ) {
          previewRepairAwaitingLaunch.current = false;
          dispatch({ type: 'preview-repair-end' });
        }
        break;
      case 'preview-available':
        dispatch({
          type: 'preview-available',
          available: event.available,
          kind: event.kind
        });
        break;
      case 'preview-open':
        // The agent asked to (re)open the preview with the current build; the
        // page defers the actual launch until the run is idle.
        if (previewRepairPending.current) {
          previewRepairRequestedLaunch.current = true;
        }
        dispatch({ type: 'auto-preview-launch' });
        break;
      case 'preview-launch-error':
        previewRepairPending.current = false;
        previewRepairSawTurn.current = false;
        previewRepairRequestedLaunch.current = false;
        previewRepairAwaitingLaunch.current = false;
        dispatch({ type: 'preview-launch-error', message: event.message });
        break;
      case 'queue-changed':
        queueEventSeen.current = true;
        dispatch({ type: 'queue', queue: mapQueue(event.queue) });
        break;
      case 'mode':
        dispatch({ type: 'mode', mode: event.mode });
        break;
      case 'project-model':
        dispatch({
          type: 'project-model',
          agentModel: event.agentModel
        });
        break;
      case 'title':
        dispatch({ type: 'title', title: event.title });
        break;
      case 'plan-presented':
        dispatch({
          type: 'plan-presented',
          steps: event.steps.filter(step => !isInternalPlanStep(step))
        });
        break;
      case 'plan-progress':
        dispatch({
          type: 'plan-progress',
          steps: mapPlanTodosToSteps(event.todos)
        });
        break;
      case 'plan-resolved':
        dispatch({ type: 'plan-resolved', approved: event.approved });
        break;
      case 'tool-approval':
        dispatch({
          type: 'tool-approval',
          approval: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.toolArgs
          }
        });
        break;
      case 'tool-approval-resolved':
        dispatch({
          type: 'tool-approval-resolved',
          toolCallId: event.toolCallId
        });
        break;
      case 'question':
        dispatch({
          type: 'question',
          question: {
            questionId: event.questionId,
            question: event.question,
            header: event.header,
            options: event.options,
            multiSelect: event.multiSelect
          }
        });
        break;
      case 'question-resolved':
        dispatch({
          type: 'question-resolved',
          questionId: event.questionId
        });
        break;
      case 'file-tree':
        dispatch({
          type: 'file-tree',
          nodes: event.nodes,
          contextNodes: event.contextNodes
        });
        break;
      case 'file-changed': {
        const changes = event.changes.map(change => ({
          path: change.path,
          kind: (change.kind === 'created'
            ? 'added'
            : change.kind === 'deleted'
              ? 'deleted'
              : 'edited') as FileHighlight
        }));
        dispatch({ type: 'file-changed', changes });
        for (const change of changes) {
          const existing = highlightTimers.current.get(change.path);
          if (existing) {
            clearTimeout(existing);
          }
          highlightTimers.current.set(
            change.path,
            setTimeout(() => {
              highlightTimers.current.delete(change.path);
              dispatch({ type: 'highlight-end', id: change.path });
            }, HIGHLIGHT_MS[change.kind])
          );
        }
        break;
      }
      case 'sub-agent-activity':
        dispatch({ type: 'sub-agent-activity', activity: event.activity });
        break;
      case 'turn-start':
        if (previewRepairPending.current) {
          previewRepairSawTurn.current = true;
        }
        break;
      case 'turn-complete':
        if (previewRepairPending.current && previewRepairSawTurn.current) {
          if (!previewRepairRequestedLaunch.current) {
            dispatch({ type: 'auto-preview-launch' });
          }
          previewRepairPending.current = false;
          previewRepairSawTurn.current = false;
          previewRepairRequestedLaunch.current = false;
          previewRepairAwaitingLaunch.current = true;
        }
        break;
      case 'idle':
        if (previewRepairPending.current) {
          previewRepairPending.current = false;
          previewRepairSawTurn.current = false;
          previewRepairRequestedLaunch.current = false;
          previewRepairAwaitingLaunch.current = false;
          dispatch({ type: 'preview-repair-end' });
        }
        break;
      case 'tool-stream':
        break;
      case 'error':
        previewRepairPending.current = false;
        previewRepairSawTurn.current = false;
        previewRepairRequestedLaunch.current = false;
        previewRepairAwaitingLaunch.current = false;
        dispatch({ type: 'preview-repair-end' });
        openDialog({
          title: t('error'),
          description: event.message,
          type: 'ok'
        });
        break;
      default:
        break;
    }
  };

  const { connection } = useAgentEvents(
    notFound ? undefined : projectId,
    handleEvent
  );

  useEffect(() => {
    dispatch({ type: 'connection', connection });
  }, [connection]);

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const load = async () => {
      try {
        const data = await getAgentProject(projectId);
        const messages = data.messages.map(mapMessageView);
        const lastWithPlan = [...messages]
          .reverse()
          .find(message => message.plan);
        dispatch({
          type: 'load',
          messages,
          queue: queueEventSeen.current ? null : mapQueue(data.queue),
          plan: lastWithPlan?.plan ?? null,
          status: data.project.status,
          mode: data.project.mode,
          agentModel: data.project.agentModel,
          title: data.project.title
        });
      } catch (error) {
        // Treat only HTTP 404 as a missing project.
        if (error instanceof ApiError && error.code === 404) {
          setNotFound(true);
          return;
        }
        openDialog({
          title: t('error'),
          description:
            error instanceof Error && error.message
              ? error.message
              : t('error_agent_project_load'),
          type: 'ok'
        });
      }
    };
    load();
  });

  useEffect(() => {
    const timers = highlightTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  // Knowledge already transcribed into this project's sandbox. The selection
  // is sticky (shared with chat), so without this every follow-up would
  // re-inject the same context note; only newly selected entries are sent.
  const sentKnowledgeIds = useRef<Set<string>>(new Set());

  const submit = async (
    text: string,
    mode: AgentMode,
    files: File[],
    preUploaded?: ContextFileRef[],
    knowledgeIds?: string[]
  ): Promise<void> => {
    setSubmitting(true);
    try {
      await submitInner(text, mode, files, preUploaded, knowledgeIds);
    } finally {
      setSubmitting(false);
    }
  };

  const submitInner = async (
    text: string,
    mode: AgentMode,
    files: File[],
    preUploaded?: ContextFileRef[],
    knowledgeIds?: string[]
  ): Promise<void> => {
    const uploaded =
      files.length > 0
        ? (
            await Promise.allSettled(files.map(file => uploadContextFile(file)))
          ).flatMap(result =>
            result.status === 'fulfilled' ? [result.value] : []
          )
        : [];
    const contextFiles = [...(preUploaded ?? []), ...uploaded];
    const newKnowledgeIds = (knowledgeIds ?? []).filter(
      id => !sentKnowledgeIds.current.has(id)
    );
    for (const id of newKnowledgeIds) {
      sentKnowledgeIds.current.add(id);
    }
    await submitAgentMessage(projectId, {
      text,
      mode,
      contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
      knowledgeIds: newKnowledgeIds.length > 0 ? newKnowledgeIds : undefined,
      webSearchEnabled,
      webSearchExtendedTimeoutEnabled
    });
  };

  const approve = () => void decideAgentPlan(projectId, 'approve');
  const reject = (feedback?: string) =>
    void decideAgentPlan(projectId, 'reject', feedback);
  const showApprovalError = (descriptionKey: string) =>
    openDialog({
      title: t('error'),
      description: t(descriptionKey),
      type: 'ok'
    });
  // The request card clears when the server's tool-approval-resolved arrives.
  const approveTool = (toolCallId: string, approved: boolean) =>
    void approveAgentToolCall(projectId, toolCallId, approved).catch(() =>
      showApprovalError('error_tool_approval')
    );
  // The question card clears when the server's question-resolved arrives.
  const answerQuestion = (questionId: string, answer: string) =>
    void answerAgentQuestion(projectId, questionId, answer).catch(() =>
      showApprovalError('error_question_answer')
    );
  // Same flow as chat: register the shared auto-approval rule, then approve.
  const autoApproveTool = (toolCallId: string, toolName: string) =>
    void (async () => {
      await upsertToolApprovalRule({ toolName, approve: 'auto_approve' });
      await approveAgentToolCall(projectId, toolCallId, true);
    })().catch(() => showApprovalError('error_tool_auto_approve'));
  const removeFromQueue = (id: string) =>
    void removeAgentQueueItem(projectId, id);
  const removeContextFile = (path: string, name: string) => {
    const dialogId = openDialog({
      type: 'cancel/ok',
      title: t('agent_context_delete_title'),
      description: t('agent_context_delete_confirm', { name }),
      okText: t('delete'),
      cancelText: t('cancel'),
      onOk: () => {
        closeDialog(dialogId);
        void deleteAgentContextFile(projectId, path);
      }
    });
  };
  // Stop means "stop the task": abort the in-flight turn AND drop the queued
  // messages — otherwise the next queued item starts right after the abort,
  // which reads as the stop button not working.
  const stop = () => void abortAgent(projectId, true);

  // The POST only kicks the open off; the lifecycle (starting → running /
  // error) flows back as gui-status events. Reflect 'starting' immediately so
  // the UI reacts before the first event arrives — unless the GUI is already
  // running, where opening just adds a browser tab (no lifecycle change).
  const openGuiPreview = (url?: string) => {
    dispatch({ type: 'preview-launch-error-clear' });
    if (state.guiStatus.status !== 'running') {
      dispatch({ type: 'gui-status', guiStatus: { status: 'starting' } });
    }
    // The Japanese IME desktop only when the UI language is Japanese — other
    // languages get the plain (pre-IME) desktop with a us keymap.
    void openAgentGui(projectId, url, i18n.locale === 'ja').catch(() => {
      previewRepairAwaitingLaunch.current = false;
      dispatch({ type: 'preview-repair-end' });
      showApprovalError('agent_gui_error_start');
    });
  };
  // Removing the sidecar takes a few seconds; flip to 'stopping' immediately
  // (the server also broadcasts it, but this skips even the SSE round-trip)
  // so the button visibly reacts instead of leaving a stale running view.
  const stopGui = () => {
    dispatch({ type: 'gui-status', guiStatus: { status: 'stopping' } });
    void stopAgentGui(projectId).catch(() =>
      showApprovalError('agent_gui_error_stop')
    );
  };
  // Hand the failure to the agent (it has bash + the build): a plain steer-mode
  // turn so it acts immediately rather than re-planning. The fix rewrites the
  // manifest, which the auto-launch then re-opens.
  const fixPreview = () => {
    const message = state.previewLaunchError;
    const prompt = message
      ? t('agent_preview_fix_prompt_with_error', { message })
      : t('agent_preview_fix_prompt');
    previewRepairPending.current = true;
    previewRepairSawTurn.current = false;
    previewRepairRequestedLaunch.current = false;
    previewRepairAwaitingLaunch.current = false;
    dispatch({ type: 'preview-repair-start' });
    void submit(prompt, 'steer', []).catch(() => {
      previewRepairPending.current = false;
      previewRepairSawTurn.current = false;
      previewRepairRequestedLaunch.current = false;
      previewRepairAwaitingLaunch.current = false;
      dispatch({ type: 'preview-repair-end' });
    });
  };
  const dismissPreviewError = () =>
    dispatch({ type: 'preview-launch-error-clear' });

  useEffect(() => {
    const message = state.previewLaunchError;
    const turnBusy =
      state.status === 'running' || state.streaming !== null || submitting;
    if (
      !message ||
      turnBusy ||
      state.sandboxStatus.status === 'unavailable' ||
      autoFixedPreviewError.current === message
    ) {
      return;
    }
    autoFixedPreviewError.current = message;
    fixPreview();
  });

  return (
    <AgentContext.Provider
      value={{
        state,
        notFound,
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
        openGuiPreview,
        stopGui,
        fixPreview,
        dismissPreviewError
      }}
    >
      {children}
    </AgentContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAgent(): AgentContextValue {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent must be used within AgentProvider');
  }
  return context;
}
