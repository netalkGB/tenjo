import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';

interface WebSearchExtendedTimeoutOptionProps {
  onChange: (checked: boolean) => void;
}

export function WebSearchExtendedTimeoutOption({
  onChange
}: WebSearchExtendedTimeoutOptionProps) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);

  const handleCheckedChange = (value: boolean | 'indeterminate') => {
    const next = value === true;
    setChecked(next);
    onChange(next);
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-start gap-2">
        <Checkbox
          id="web-search-extended-timeout"
          checked={checked}
          onCheckedChange={handleCheckedChange}
          data-testid="web-search-extended-timeout-checkbox"
        />
        <Label
          htmlFor="web-search-extended-timeout"
          className="text-sm leading-5"
        >
          {t('web_search_extended_timeout_label')}
        </Label>
      </div>
      {checked && (
        <p
          className="text-sm font-semibold text-red-600 dark:text-red-400"
          data-testid="web-search-extended-timeout-warning"
        >
          {t('web_search_extended_timeout_warning')}
        </p>
      )}
    </div>
  );
}
