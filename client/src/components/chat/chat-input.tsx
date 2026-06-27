import { Button } from '@/components/ui/button';
import { ArrowUp, Square, Plus, ImagePlus, Loader2, Code2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useRef, useEffect, useState } from 'react';
import { useSettings } from '@/contexts/settings-context';
import { ToolPicker } from './tool-picker';
import { KnowledgePicker } from './knowledge-picker';
import { WebSearchToggle } from './web-search-toggle';
import { Skeleton } from '@/components/ui/skeleton';
import {
  validateImageFile,
  type UploadResponse,
  type UploadProgress
} from '@/api/server/chat/upload';
import { formatModelLabel } from '@/lib/providerLabels';
import { generateRandomId } from '@/lib/generateRandomId';
import { AttachmentPreviewList } from '@/components/common/attachment-preview-list';

export interface ImageAttachment {
  id: string;
  file: File;
  previewUrl: string;
  uploadedUrl?: string;
  progress: number;
  error?: string;
}

interface ChatInputProps {
  onSendMessage: (text: string, imageUrls: string[]) => void;
  uploadImageFile: (
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ) => Promise<UploadResponse>;
  isStreaming?: boolean;
  isGeneratingLocked?: boolean;
  onStop?: () => void;
  selectedKnowledge: Set<string>;
  onToggleKnowledge: (id: string) => void;
}

export function ChatInput({
  onSendMessage,
  uploadImageFile,
  isStreaming,
  isGeneratingLocked,
  onStop,
  selectedKnowledge,
  onToggleKnowledge
}: ChatInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const initialized = useRef(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    models,
    activeModelId,
    setActiveModelId,
    availableToolsByServer,
    mcpToolErrors,
    enabledTools,
    isToolsLoaded,
    toggleTool,
    toggleServerTools,
    enableAllTools,
    disableAllTools,
    executeCodeEnabled,
    toggleExecuteCodeEnabled
  } = useSettings();

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    setText(textarea.value);
    const maxHeight =
      parseFloat(getComputedStyle(document.documentElement).fontSize) * 10;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  };

  const allUploaded = images.every(img => img.uploadedUrl && !img.error);
  const hasContent = text.trim().length > 0 || images.length > 0;
  const canSend =
    hasContent &&
    !!activeModelId &&
    allUploaded &&
    !isGeneratingLocked &&
    !isStreaming;

  const handleSendMessage = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (!activeModelId || !allUploaded || isGeneratingLocked || isStreaming) {
      return;
    }

    const messageText = textarea.value;
    if (messageText.trim().length === 0 && images.length === 0) return;

    const imageUrls = images
      .filter(img => img.uploadedUrl)
      .map(img => img.uploadedUrl!);
    onSendMessage(messageText, imageUrls);
    textarea.value = '';
    setText('');
    images.forEach(img => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
    handleInput();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const processFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const id = generateRandomId();
      const previewUrl = URL.createObjectURL(file);

      // Validate magic number before adding
      try {
        await validateImageFile(file);
      } catch {
        setImages(prev => [
          ...prev,
          {
            id,
            file,
            previewUrl,
            progress: 0,
            error: t('image_invalid_type')
          }
        ]);
        continue;
      }

      // Add image with 0 progress
      setImages(prev => [...prev, { id, file, previewUrl, progress: 0 }]);

      // Start upload
      try {
        const result = await uploadImageFile(
          file,
          (progress: UploadProgress) => {
            setImages(prev =>
              prev.map(img =>
                img.id === id ? { ...img, progress: progress.percentage } : img
              )
            );
          }
        );

        setImages(prev =>
          prev.map(img =>
            img.id === id
              ? { ...img, progress: 100, uploadedUrl: result.url }
              : img
          )
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t('image_upload_failed');
        setImages(prev =>
          prev.map(img => (img.id === id ? { ...img, error: message } : img))
        );
      }
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => {
      const img = prev.find(i => i.id === id);
      if (img) URL.revokeObjectURL(img.previewUrl);
      return prev.filter(i => i.id !== id);
    });
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
    setMenuOpen(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  // Drag & drop handlers
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
      processFiles(e.dataTransfer.files);
    }
  };

  // Global drag & drop on the window
  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragOver(true);
      }
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      // Only set false if leaving the window
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        setIsDragOver(false);
      }
    };

    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  });

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    handleInput();
  });

  if (!isToolsLoaded) {
    return (
      <div className="border p-2.5 rounded-lg shadow-xl">
        <Skeleton className="h-6 w-full rounded" />
        <div className="flex justify-end gap-2 mt-3">
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-30 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`@container border p-2.5 rounded-lg shadow-xl relative transition-colors ${
        isDragOver ? 'border-primary bg-primary/5' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10 border-2 border-dashed border-primary pointer-events-none">
          <div className="flex items-center gap-2 text-primary font-medium">
            <ImagePlus className="w-5 h-5" />
            <span>{t('image_drop_here')}</span>
          </div>
        </div>
      )}

      <AttachmentPreviewList
        items={images.map(img => ({
          id: img.id,
          name: img.file.name,
          size: img.file.size,
          previewUrl: img.previewUrl,
          progress: img.progress,
          isUploaded: !!img.uploadedUrl,
          error: img.error
        }))}
        removeLabel={t('agent_remove_file')}
        onRemove={removeImage}
      />

      <div>
        <textarea
          ref={textareaRef}
          placeholder={t('chat_placeholder')}
          className="w-full border-0 focus:outline-none focus:ring-0 resize-none overflow-y-auto"
          data-testid="chat-input-textarea"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
        ></textarea>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-1 justify-end">
        {/* + button with menu */}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-9 h-9 cursor-pointer shrink-0 mr-auto"
              data-testid="chat-input-plus-button"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1">
            <button
              className="flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
              onClick={handleFileSelect}
              data-testid="chat-input-image-add-button"
            >
              <ImagePlus className="w-4 h-4" />
              {t('image_add')}
            </button>
          </PopoverContent>
        </Popover>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
          data-testid="chat-input-file-input"
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              className="w-9 h-9 @sm:w-auto @sm:h-9 @sm:gap-1.5 cursor-pointer shrink-0 @max-sm:aria-pressed:bg-primary! @max-sm:aria-pressed:text-primary-foreground @max-sm:aria-pressed:border-primary! @max-sm:aria-pressed:hover:bg-primary/90!"
              onClick={toggleExecuteCodeEnabled}
              aria-pressed={executeCodeEnabled}
              aria-label={t('execute_code')}
              data-testid="chat-input-execute-code-button"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span className="text-xs hidden @sm:inline">
                {executeCodeEnabled ? t('on') : t('off')}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('execute_code')}</TooltipContent>
        </Tooltip>
        <WebSearchToggle testId="chat-input-web-search-button" />
        <KnowledgePicker
          selectedIds={selectedKnowledge}
          onToggle={onToggleKnowledge}
        />
        <ToolPicker
          availableToolsByServer={availableToolsByServer}
          mcpToolErrors={mcpToolErrors}
          enabledTools={enabledTools}
          onToggle={toggleTool}
          onToggleServer={toggleServerTools}
          onEnableAll={enableAllTools}
          onDisableAll={disableAllTools}
        />
        <div className="flex items-center gap-2 flex-1 min-w-0 @sm:flex-none @max-sm:basis-full">
          <Select
            value={activeModelId || undefined}
            onValueChange={setActiveModelId}
            disabled={models.length === 0}
          >
            <SelectTrigger
              className="min-w-0 flex-1 @sm:flex-none @sm:min-w-30 @max-sm:text-xs"
              data-testid="chat-input-model-select"
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
          {isStreaming ? (
            <Button
              variant="outline"
              className="w-9 h-9 cursor-pointer shrink-0"
              onClick={onStop}
              data-testid="chat-input-stop-button"
            >
              <Square className="w-3 h-3 fill-current" />
            </Button>
          ) : (
            <Button
              className="w-9 h-9 cursor-pointer shrink-0"
              onClick={handleSendMessage}
              disabled={!canSend}
              data-testid="chat-input-send-button"
            >
              <ArrowUp className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
      {isGeneratingLocked && (
        <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{t('status_generating_locked')}</span>
        </div>
      )}
    </div>
  );
}
