import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle
} from '@/components/ui/dialog';
import { VisuallyHidden } from 'radix-ui';
import { XIcon } from 'lucide-react';

interface ImagePreviewDialogProps {
  imageUrl: string | null;
  onClose: () => void;
}

export function ImagePreviewDialog({
  imageUrl,
  onClose
}: ImagePreviewDialogProps) {
  return (
    <Dialog open={imageUrl !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-w-[90vw] max-h-[90vh] w-auto pt-8 px-2 pb-2 gap-0"
      >
        <VisuallyHidden.Root>
          <DialogTitle>Image preview</DialogTitle>
        </VisuallyHidden.Root>
        <DialogClose className="absolute top-1.5 right-2 rounded-xs opacity-70 transition-opacity hover:opacity-100 cursor-pointer">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogClose>
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="max-w-full max-h-[80vh] object-contain rounded"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
