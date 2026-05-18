import { useState } from 'react';
import { UserMessage } from './user-message';
import { UserMessageEdit } from './user-message-edit';
import { UserMessageActions } from './user-message-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { copyTextToClipboard } from '@/lib/clipboard';
import { ImagePreviewDialog } from './image-preview-dialog';

interface UserMessageSectionProps {
  message?: string;
  imageUrls?: string[];
  currentCount?: number;
  totalCount?: number;
  skeleton?: boolean;
  isStreaming?: boolean;
  editing?: boolean;
  editValue?: string;
  onEditStart?: () => void;
  onEditChange?: (value: string) => void;
  onEditCancel?: () => void;
  onSave?: (editedMessage: string) => void;
  onRetry?: () => void;
  onCopy?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const noop = () => {};

export function UserMessageSection({
  message = '',
  imageUrls,
  currentCount = 1,
  totalCount = 1,
  skeleton = false,
  isStreaming = false,
  editing = false,
  editValue = '',
  onEditStart,
  onEditChange,
  onEditCancel,
  onSave,
  onRetry,
  onCopy,
  onPrevious,
  onNext
}: UserMessageSectionProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleCopy = async () => {
    await copyTextToClipboard(message);
    if (onCopy) {
      onCopy();
    }
  };

  if (skeleton) {
    return (
      <div className="group">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <UserMessageEdit
        value={editValue}
        onChange={onEditChange ?? noop}
        onCancel={onEditCancel ?? noop}
        onSave={onSave ?? noop}
      />
    );
  }

  return (
    <div className="group">
      {imageUrls && imageUrls.length > 0 && (
        <div className="flex justify-end mb-2">
          <div className="flex flex-wrap gap-2 max-w-[85%] justify-end">
            {imageUrls.map((url, index) => (
              <button
                key={index}
                onClick={() => setPreviewImage(url)}
                className="cursor-pointer rounded-lg overflow-hidden border border-border hover:border-primary transition-colors"
              >
                <img src={url} alt="" className="w-24 h-24 object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
      <UserMessage>{message}</UserMessage>
      <UserMessageActions
        isVisible={!isStreaming}
        onEdit={onEditStart}
        onRetry={onRetry}
        onCopy={handleCopy}
        onPrevious={onPrevious}
        onNext={onNext}
        currentCount={currentCount}
        totalCount={totalCount}
      />
      <ImagePreviewDialog
        imageUrl={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
}
