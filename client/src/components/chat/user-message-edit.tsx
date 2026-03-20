import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/useTranslation';
import { useState } from 'react';

interface UserMessageEditProps {
  defaultValue: string;
  onCancel: () => void;
  onSave: (editedMessage: string) => void;
}

export function UserMessageEdit({
  defaultValue,
  onCancel,
  onSave
}: UserMessageEditProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);

  const handleSave = () => {
    onSave(value);
  };

  return (
    <div className="bg-secondary text-secondary-foreground rounded-lg p-3 mb-7">
      <div>
        <Textarea
          className="bg-background text-foreground"
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        <div className="flex justify-end mt-3">
          <div className="ml-2">
            <Button variant="outline" onClick={onCancel}>
              {t('cancel')}
            </Button>
          </div>
          <div className="ml-2">
            <Button onClick={handleSave}>{t('save')}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
