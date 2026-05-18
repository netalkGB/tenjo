import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/useTranslation';

interface UserMessageEditProps {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: (editedMessage: string) => void;
}

export function UserMessageEdit({
  value,
  onChange,
  onCancel,
  onSave
}: UserMessageEditProps) {
  const { t } = useTranslation();

  const handleSave = () => {
    onSave(value);
  };

  return (
    <div className="bg-secondary text-secondary-foreground rounded-lg p-3 mb-7">
      <div>
        <Textarea
          className="bg-background text-foreground"
          value={value}
          onChange={e => onChange(e.target.value)}
          data-testid="user-message-edit-textarea"
        />
        <div className="flex justify-end mt-3">
          <div className="ml-2">
            <Button
              variant="outline"
              onClick={onCancel}
              data-testid="user-message-edit-cancel-button"
            >
              {t('cancel')}
            </Button>
          </div>
          <div className="ml-2">
            <Button
              onClick={handleSave}
              data-testid="user-message-edit-save-button"
            >
              {t('save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
