import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface RenameDialogFooterProps {
  isDisabled: boolean;
  onCancel: () => void;
  onSave: () => Promise<void>;
}

export function RenameDialogFooter({
  isDisabled,
  onCancel,
  onSave
}: RenameDialogFooterProps) {
  const { t } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex gap-2 w-full justify-end">
      <Button
        variant="outline"
        onClick={onCancel}
        disabled={isSaving}
        data-testid="rename-dialog-cancel-button"
      >
        {t('cancel')}
      </Button>
      <Button
        onClick={handleSave}
        disabled={isDisabled || isSaving}
        data-testid="rename-dialog-save-button"
      >
        {isSaving ? t('saving') : t('save')}
      </Button>
    </div>
  );
}
