import { Paperclip, X } from 'lucide-react';
import { formatFileSize } from '@/lib/formatFileSize';

export interface AttachmentPreviewItem {
  id: string;
  name: string;
  size: number;
  previewUrl?: string;
  progress?: number;
  isUploaded?: boolean;
  error?: string;
}

interface AttachmentPreviewListProps {
  items: AttachmentPreviewItem[];
  removeLabel: string;
  onRemove: (id: string) => void;
  testIdPrefix?: string;
  removeTestIdPrefix?: string;
}

export function AttachmentPreviewList({
  items,
  removeLabel,
  onRemove,
  testIdPrefix = 'attachment-preview',
  removeTestIdPrefix = `${testIdPrefix}-remove`
}: AttachmentPreviewListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {items.map(item =>
        item.previewUrl ? (
          <div
            key={item.id}
            className="group relative h-16 w-16"
            data-testid={`${testIdPrefix}-${item.id}`}
          >
            <img
              src={item.previewUrl}
              alt={item.name}
              className={`h-16 w-16 rounded-md border object-cover ${
                item.error ? 'border-destructive opacity-50' : 'border-border'
              }`}
            />
            {!item.isUploaded && !item.error && (
              <ProgressBar progress={item.progress ?? 0} />
            )}
            {item.error && <ErrorBadge />}
            <RemoveButton
              id={item.id}
              label={removeLabel}
              onRemove={onRemove}
              testIdPrefix={removeTestIdPrefix}
            />
          </div>
        ) : (
          <div
            key={item.id}
            className={`group relative flex min-h-8 max-w-full items-center gap-1.5 overflow-hidden rounded-md border bg-muted/40 px-2 py-1 text-xs ${
              item.error ? 'border-destructive' : 'border-border'
            }`}
            data-testid={`${testIdPrefix}-${item.id}`}
          >
            <Paperclip className="size-3 shrink-0 text-muted-foreground" />
            <span className="max-w-40 truncate font-medium">{item.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {formatFileSize(item.size)}
            </span>
            {item.error && (
              <span className="shrink-0 text-destructive">Error</span>
            )}
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="ml-0.5 shrink-0 rounded text-muted-foreground hover:text-foreground"
              aria-label={removeLabel}
              data-testid={`${removeTestIdPrefix}-${item.id}`}
            >
              <X className="size-3" />
            </button>
            {!item.isUploaded && !item.error && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${item.progress ?? 0}%` }}
                />
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-md bg-muted">
      <div
        className="h-full bg-primary transition-all duration-200"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function ErrorBadge() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="rounded bg-background/80 px-1 text-xs font-medium text-destructive">
        Error
      </span>
    </div>
  );
}

function RemoveButton({
  id,
  label,
  onRemove,
  testIdPrefix
}: {
  id: string;
  label: string;
  onRemove: (id: string) => void;
  testIdPrefix: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onRemove(id)}
      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100"
      aria-label={label}
      data-testid={`${testIdPrefix}-remove-${id}`}
    >
      <X className="size-3" />
    </button>
  );
}
