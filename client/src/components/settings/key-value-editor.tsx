import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import type { KeyValueEntry } from './key-value-utils';

interface KeyValueEditorProps {
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder
}: KeyValueEditorProps) {
  const { t } = useTranslation();

  const handleAdd = () => {
    onChange([...entries, { key: '', value: '' }]);
  };

  const handleRemove = (index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  };

  const handleChange = (
    index: number,
    field: 'key' | 'value',
    newValue: string
  ) => {
    onChange(
      entries.map((entry, i) =>
        i === index ? { ...entry, [field]: newValue } : entry
      )
    );
  };

  return (
    <div className="space-y-2">
      {entries.map((entry, index) => (
        <div key={index} className="flex gap-2 items-center">
          <Input
            className="flex-1"
            placeholder={keyPlaceholder ?? t('settings_mcp_key')}
            value={entry.key}
            onChange={e => handleChange(index, 'key', e.target.value)}
          />
          <Input
            className="flex-1"
            placeholder={valuePlaceholder ?? t('settings_mcp_value')}
            value={entry.value}
            onChange={e => handleChange(index, 'value', e.target.value)}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleRemove(index)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('delete')}</TooltipContent>
          </Tooltip>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
        <Plus className="size-4 mr-1" />
        {t('settings_mcp_add_entry')}
      </Button>
    </div>
  );
}
