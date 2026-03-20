import { Button } from '@/components/ui/button';
import { ArrowUp, Square, Plus, ImagePlus, X } from 'lucide-react';
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
import { useRef, useEffect, useState, useCallback } from 'react';
import { useSettings } from '@/contexts/settings-context';
import type { Model } from '@/api/server/settings';
import { ToolPicker } from './tool-picker';
import { Skeleton } from '@/components/ui/skeleton';
import {
  uploadImage,
  validateImageFile,
  type UploadProgress
} from '@/api/server/chat/upload';
import { formatProviderLabel } from '@/lib/providerLabels';

function formatModelLabel(model: Model): string {
  return `${formatProviderLabel(model.type)} / ${model.model}`;
}

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
  isStreaming?: boolean;
  onStop?: () => void;
}

export function ChatInput({
  onSendMessage,
  isStreaming,
  onStop
}: ChatInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    models,
    activeModelId,
    setActiveModelId,
    availableToolsByServer,
    enabledTools,
    isToolsLoaded,
    toggleTool,
    toggleServerTools,
    enableAllTools,
    disableAllTools
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
  const canSend = hasContent && !!activeModelId && allUploaded;

  const handleSendMessage = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (!canSend) return;

    const imageUrls = images
      .filter(img => img.uploadedUrl)
      .map(img => img.uploadedUrl!);
    onSendMessage(text, imageUrls);
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

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);

      for (const file of fileArray) {
        const id = crypto.randomUUID();
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
          const result = await uploadImage(file, (progress: UploadProgress) => {
            setImages(prev =>
              prev.map(img =>
                img.id === id ? { ...img, progress: progress.percentage } : img
              )
            );
          });

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
    },
    [t]
  );

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
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

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
  }, [processFiles]);

  useEffect(() => {
    handleInput();
  }, []);

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
      className={`border p-2.5 rounded-lg shadow-xl relative transition-colors ${
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

      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map(img => (
            <div key={img.id} className="relative group w-16 h-16">
              <img
                src={img.previewUrl}
                alt=""
                className={`w-16 h-16 object-cover rounded-md border ${
                  img.error ? 'border-destructive opacity-50' : 'border-border'
                }`}
              />
              {/* Progress bar */}
              {!img.uploadedUrl && !img.error && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted rounded-b-md overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${img.progress}%` }}
                  />
                </div>
              )}
              {/* Error indicator */}
              {img.error && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-destructive text-xs font-medium bg-background/80 px-1 rounded">
                    Error
                  </span>
                </div>
              )}
              {/* Remove button */}
              <button
                onClick={() => removeImage(img.id)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-foreground text-background rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <textarea
          ref={textareaRef}
          placeholder={t('chat_placeholder')}
          className="w-full border-0 focus:outline-none focus:ring-0 resize-none overflow-y-auto"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
        ></textarea>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {/* + button with menu */}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-9 h-9 cursor-pointer">
              <Plus className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1">
            <button
              className="flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
              onClick={handleFileSelect}
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
        />

        <div className="flex-1" />

        <ToolPicker
          availableToolsByServer={availableToolsByServer}
          enabledTools={enabledTools}
          onToggle={toggleTool}
          onToggleServer={toggleServerTools}
          onEnableAll={enableAllTools}
          onDisableAll={disableAllTools}
        />
        <Select
          value={activeModelId || undefined}
          onValueChange={setActiveModelId}
          disabled={models.length === 0}
        >
          <SelectTrigger className="min-w-30">
            <SelectValue placeholder={t('settings_select_model')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t('settings_select_model')}</SelectLabel>
              {models.map(model => (
                <SelectItem key={model.id} value={model.id}>
                  {formatModelLabel(model)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {isStreaming ? (
          <Button
            variant="outline"
            className="w-9 h-9 cursor-pointer"
            onClick={onStop}
          >
            <Square className="w-3 h-3 fill-current" />
          </Button>
        ) : (
          <Button
            className="w-9 h-9 cursor-pointer"
            onClick={handleSendMessage}
            disabled={!canSend}
          >
            <ArrowUp className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
