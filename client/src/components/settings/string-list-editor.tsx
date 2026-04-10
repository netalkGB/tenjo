import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

interface StringListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}

export function StringListEditor({
  items,
  onChange,
  placeholder
}: StringListEditorProps) {
  const { t } = useTranslation();

  const handleAdd = () => {
    onChange([...items, '']);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, newValue: string) => {
    onChange(items.map((item, i) => (i === index ? newValue : item)));
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex gap-2 items-center">
          <Input
            className="flex-1"
            placeholder={placeholder}
            value={item}
            onChange={e => handleChange(index, e.target.value)}
            data-testid="settings-mcp-dialog-string-list-input"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleRemove(index)}
                data-testid="settings-mcp-dialog-string-list-delete-button"
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('delete')}</TooltipContent>
          </Tooltip>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAdd}
        data-testid="settings-mcp-dialog-string-list-add-button"
      >
        <Plus className="size-4 mr-1" />
        {t('settings_mcp_add_entry')}
      </Button>
    </div>
  );
}
