import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  CircleStop,
  Hand,
  ListChecks,
  Lock,
  Paperclip
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useSettings } from '@/contexts/settings-context';
import { formatModelLabel } from '@/lib/providerLabels';
import { useTranslation } from '@/hooks/useTranslation';
import { validateImageFile } from '@/api/server/chat/upload';
import { uploadContextFile, type ContextFileRef } from '@/api/server/agent';
import { generateRandomId } from '@/lib/generateRandomId';
import { AgentOptionsMenu } from './agent-options-menu';
import { AttachmentPreviewList } from '@/components/common/attachment-preview-list';
import type { AgentMode } from './types';
import type { UploadProgress } from '@/api/server/chat/upload';

interface AgentPromptInputProps {
  placeholderKey?: string;
  initialValue?: string;
  onSubmit: (
    value: string,
    files: File[],
    contextFiles: ContextFileRef[],
    knowledgeIds: string[]
  ) => void;
  /** Controlled agent mode. Omit to let the input manage it internally. */
  mode?: AgentMode;
  onModeChange?: (mode: AgentMode) => void;
  /** When true, the run button is replaced by a stop button wired to onStop. */
  isBusy?: boolean;
  onStop?: () => void;
  /** Disable submission (for example when the sandbox is unavailable). */
  disabled?: boolean;
  /** Tooltip explaining why submission is disabled (shown on the run button). */
  disabledHint?: string;
  /** Render the project-locked model instead of the global model selector. */
  modelLocked?: boolean;
  lockedModelLabel?: string;
}

interface AttachedFile {
  id: string;
  file: File;
  /** Object URL for image previews; undefined for non-image files. */
  previewUrl?: string;
  progress: number;
  contextFile?: ContextFileRef;
  error?: string;
}

export function AgentPromptInput({
  placeholderKey = 'agent_prompt_placeholder',
  initialValue = '',
  onSubmit,
  mode: controlledMode,
  onModeChange,
  isBusy = false,
  onStop,
  disabled = false,
  disabledHint,
  modelLocked = false,
  lockedModelLabel
}: AgentPromptInputProps) {
  const { t } = useTranslation();
  const { models, activeModelId, setActiveModelId, selectedKnowledge } =
    useSettings();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialValue);
  const initialized = useRef(false);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  // The agent starts in plan mode; switches to steer once a plan is approved.
  const [internalMode, setInternalMode] = useState<AgentMode>('plan');
  const mode = controlledMode ?? internalMode;

  const handleModeChange = (next: AgentMode) => {
    if (controlledMode === undefined) {
      setInternalMode(next);
    }
    onModeChange?.(next);
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setText(textarea.value);
    const maxHeight =
      parseFloat(getComputedStyle(document.documentElement).fontSize) * 10;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    handleInput();
  });

  // Revoke any outstanding preview object URLs on unmount to avoid leaks.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => {
    return () => {
      filesRef.current.forEach(f => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
  }, []);

  const hasModel = modelLocked || !!activeModelId;
  const allFilesUploaded = files.every(file => file.contextFile && !file.error);
  const canSend =
    !disabled &&
    hasModel &&
    allFilesUploaded &&
    (text.trim().length > 0 || files.length > 0);
  const submitDisabledHint = disabled
    ? disabledHint
    : !hasModel
      ? t('settings_select_model')
      : undefined;

  const handleSubmit = () => {
    if (!canSend) return;

    const textarea = textareaRef.current;
    const prompt = textarea?.value ?? text;
    if (prompt.trim().length === 0 && files.length === 0 && !allFilesUploaded) {
      return;
    }

    onSubmit(
      prompt.trim(),
      files.map(f => f.file),
      files.flatMap(f => (f.contextFile ? [f.contextFile] : [])),
      [...selectedKnowledge]
    );
    if (textarea) {
      textarea.value = '';
    }
    setText('');
    files.forEach(f => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    setFiles([]);
    handleInput();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Add files to the attachment list. Files that pass the image magic-number
  // check get an object-URL preview; everything else stays a plain chip.
  const addFiles = async (fileList: FileList | File[]) => {
    for (const file of Array.from(fileList)) {
      const id = generateRandomId();
      let previewUrl: string | undefined;
      try {
        await validateImageFile(file);
        previewUrl = URL.createObjectURL(file);
      } catch {
        // Not a supported image; keep it as a generic file attachment.
      }
      setFiles(prev => [...prev, { id, file, previewUrl, progress: 0 }]);
      void uploadAttachedFile(id, file);
    }
  };

  const uploadAttachedFile = async (id: string, file: File) => {
    try {
      const contextFile = await uploadContextFile(
        file,
        (progress: UploadProgress) => {
          setFiles(prev =>
            prev.map(item =>
              item.id === id ? { ...item, progress: progress.percentage } : item
            )
          );
        }
      );
      setFiles(prev =>
        prev.map(item =>
          item.id === id ? { ...item, progress: 100, contextFile } : item
        )
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('agent_file_upload_failed');
      setFiles(prev =>
        prev.map(item => (item.id === id ? { ...item, error: message } : item))
      );
    }
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void addFiles(e.target.files);
      e.target.value = '';
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const target = prev.find(f => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(f => f.id !== id);
    });
  };

  // Paste an image from the clipboard. Only image items are consumed; any other
  // paste (text, file paths) falls through to the textarea's default handling.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) return;

    e.preventDefault();
    void addFiles(imageFiles);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void addFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      className={`@container border p-2.5 rounded-lg shadow-xl relative transition-colors ${
        isDragOver ? 'border-primary bg-primary/5' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="agent-prompt-input"
    >
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 pointer-events-none">
          <div className="flex items-center gap-2 text-primary font-medium">
            <Paperclip className="w-5 h-5" />
            <span>{t('agent_drop_here')}</span>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="agent-prompt-file-input"
      />

      <AttachmentPreviewList
        items={files.map(item => ({
          id: item.id,
          name: item.file.name,
          size: item.file.size,
          previewUrl: item.previewUrl,
          progress: item.progress,
          isUploaded: !!item.contextFile,
          error: item.error
        }))}
        removeLabel={t('agent_remove_file')}
        onRemove={removeFile}
        testIdPrefix="agent-prompt-file-chip"
        removeTestIdPrefix="agent-prompt-file-remove"
      />

      <div>
        <textarea
          ref={textareaRef}
          placeholder={t(placeholderKey)}
          className="w-full border-0 focus:outline-none focus:ring-0 resize-none overflow-y-auto"
          data-testid="agent-prompt-textarea"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {/* File attach, web search, knowledge and MCP tools live in a single
            menu. Web search and tool selection are shared with the chat
            input (persisted per user) and re-applied before each turn. */}
        <AgentOptionsMenu onAttachFile={handleAttachClick} />

        <Select
          value={mode}
          onValueChange={value => handleModeChange(value as AgentMode)}
        >
          <SelectTrigger
            className="h-9 max-w-[calc(100cqw-4rem)] gap-1.5 overflow-hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate"
            aria-label={t('agent_mode_label')}
            data-testid="agent-prompt-mode-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="plan" data-testid="agent-prompt-mode-plan">
              <ListChecks className="w-3.5 h-3.5" />
              {t('agent_plan_mode')}
            </SelectItem>
            <SelectItem value="steer" data-testid="agent-prompt-mode-steer">
              <Hand className="w-3.5 h-3.5" />
              {t('agent_steer_mode')}
            </SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex min-w-0 items-center gap-2 @max-2xl:ml-0 @max-2xl:basis-full @max-2xl:flex-1">
          {modelLocked ? (
            <div
              className="flex h-9 w-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground @2xl:w-70 @2xl:flex-none @max-sm:text-xs"
              title={lockedModelLabel ?? t('agent_model_loading')}
              data-testid="agent-prompt-model-locked"
            >
              <Lock className="size-3.5 shrink-0" />
              <span className="truncate">
                {lockedModelLabel ?? t('agent_model_loading')}
              </span>
            </div>
          ) : (
            <Select
              value={activeModelId || undefined}
              onValueChange={setActiveModelId}
              disabled={models.length === 0}
            >
              <SelectTrigger
                className="h-9 w-full min-w-0 flex-1 overflow-hidden @2xl:w-70 @2xl:flex-none @max-sm:text-xs [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate"
                data-testid="agent-prompt-model-select"
              >
                <SelectValue placeholder={t('settings_select_model')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t('settings_select_model')}</SelectLabel>
                  {models.map(model => (
                    <SelectItem key={model.id} value={model.id}>
                      {formatModelLabel(model, models)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {isBusy && onStop && (
            <Button
              variant="outline"
              className="h-9 cursor-pointer shrink-0 gap-1.5"
              onClick={onStop}
              data-testid="agent-stop"
              type="button"
              aria-label={t('agent_stop')}
            >
              <CircleStop className="w-4 h-4" />
            </Button>
          )}
          {/* When disabled (for example when the sandbox is unavailable), a wrapping span carries
              the tooltip — a disabled button itself fires no hover events. */}
          <span title={submitDisabledHint} className="shrink-0">
            <Button
              className="h-9 shrink-0 cursor-pointer gap-1.5 px-3 @max-xs:size-9 @max-xs:gap-0 @max-xs:px-0"
              onClick={handleSubmit}
              disabled={!canSend}
              data-testid="agent-prompt-submit"
              type="button"
              aria-label={t('agent_run')}
            >
              <span className="@max-xs:sr-only">{t('agent_run')}</span>
              <ArrowUp className="w-4 h-4" />
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
