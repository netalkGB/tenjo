import { createContext, useState, ReactNode } from 'react';

/* eslint-disable react-refresh/only-export-components */

interface DialogConfig {
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  content?: ReactNode;
  type: 'cancel/ok' | 'ok/cancel' | 'ok' | 'custom';
  okText: string;
  cancelText: string;
  showCloseButton: boolean;
  closeOnOutsideClick: boolean;
  customFooter?: ReactNode;
  onOk: () => void;
  onCancel: () => void;
}

interface DialogOpenConfig {
  title?: ReactNode;
  description?: ReactNode;
  content?: ReactNode;
  type?: 'cancel/ok' | 'ok/cancel' | 'ok' | 'custom';
  okText?: string;
  cancelText?: string;
  showCloseButton?: boolean;
  closeOnOutsideClick?: boolean;
  customFooter?: ReactNode;
  onOk?: () => void;
  onCancel?: () => void;
}

interface DialogContextType {
  dialogs: DialogConfig[];
  openDialog: (config: DialogOpenConfig) => string;
  closeDialog: (id: string) => void;
  closeAllDialogs: () => void;
}

export const DialogContext = createContext<DialogContextType | undefined>(
  undefined
);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialogs, setDialogs] = useState<DialogConfig[]>([]);

  const openDialog = (newConfig: DialogOpenConfig): string => {
    const id = crypto.randomUUID();
    const close = () => setDialogs(prev => prev.filter(d => d.id !== id));
    const dialog: DialogConfig = {
      id,
      type: newConfig.type ?? 'ok',
      okText: newConfig.okText ?? 'OK',
      cancelText: newConfig.cancelText ?? 'Cancel',
      showCloseButton: newConfig.showCloseButton ?? true,
      closeOnOutsideClick: newConfig.closeOnOutsideClick ?? false,
      onOk: newConfig.onOk ?? close,
      onCancel: newConfig.onCancel ?? close,
      title: newConfig.title,
      description: newConfig.description,
      content: newConfig.content,
      customFooter: newConfig.customFooter
    };
    setDialogs(prev => [...prev, dialog]);
    return id;
  };

  const closeDialog = (id: string) => {
    setDialogs(prev => prev.filter(d => d.id !== id));
  };

  const closeAllDialogs = () => {
    setDialogs([]);
  };

  return (
    <DialogContext.Provider
      value={{
        dialogs,
        openDialog,
        closeDialog,
        closeAllDialogs
      }}
    >
      {children}
    </DialogContext.Provider>
  );
}
