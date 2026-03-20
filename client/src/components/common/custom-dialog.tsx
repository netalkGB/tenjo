import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

interface CustomDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOk?: () => void;
  onCancel?: () => void;
  showCloseButton: boolean;
  closeOnOutsideClick?: boolean;
  modal?: boolean;
  type: 'cancel/ok' | 'ok/cancel' | 'ok' | 'custom';
  okText?: string;
  cancelText?: string;
  title?: React.ReactNode;
  content?: React.ReactNode;
  description?: React.ReactNode;
  customFooter?: React.ReactNode;
}

export function CustomDialog({
  isOpen,
  onOpenChange,
  onOk = () => {},
  onCancel = () => {},
  showCloseButton,
  closeOnOutsideClick = false,
  modal = true,
  type,
  okText = 'OK',
  cancelText = 'Cancel',
  title,
  description,
  content = <></>,
  customFooter
}: CustomDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange} modal={modal}>
      <DialogContent
        className="sm:max-w-sm"
        showCloseButton={showCloseButton}
        onPointerDownOutside={e => {
          if (!closeOnOutsideClick) {
            e.preventDefault();
          }
        }}
        onInteractOutside={e => {
          if (!closeOnOutsideClick) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          {title && <DialogTitle>{title}</DialogTitle>}
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div>{content}</div>
        <DialogFooter>
          {type === 'cancel/ok' && (
            <>
              <Button variant="outline" onClick={onCancel}>
                {cancelText}
              </Button>
              <Button type="submit" onClick={onOk}>
                {okText}
              </Button>
            </>
          )}
          {type === 'ok/cancel' && (
            <>
              <Button type="submit" onClick={onOk}>
                {okText}
              </Button>
              <Button variant="outline" onClick={onCancel}>
                {cancelText}
              </Button>
            </>
          )}
          {type === 'ok' && (
            <Button type="submit" onClick={onOk}>
              {okText}
            </Button>
          )}
          {type === 'custom' && customFooter}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
