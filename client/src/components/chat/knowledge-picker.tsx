import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useSettings } from '@/contexts/settings-context';

interface KnowledgePickerProps {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

export function KnowledgePicker({
  selectedIds,
  onToggle
}: KnowledgePickerProps) {
  const { t } = useTranslation();
  const { knowledgeList } = useSettings();
  const [search, setSearch] = useState('');

  const filtered = search
    ? knowledgeList.filter(k =>
        k.name.toLowerCase().includes(search.toLowerCase())
      )
    : knowledgeList;

  if (knowledgeList.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 gap-1.5 cursor-pointer"
          data-testid="chat-input-knowledge-button"
        >
          <BookOpen className="w-3.5 h-3.5" />
          {selectedIds.size > 0 && (
            <span className="text-xs">{selectedIds.size}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="mb-2">
          <Input
            placeholder={t('knowledge_search')}
            value={search}
            data-testid="chat-input-knowledge-search"
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="max-h-60 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">
              {t('knowledge_no_entries')}
            </p>
          ) : (
            filtered.map(entry => (
              <label
                key={entry.id}
                className="flex items-center gap-2 py-1 px-1 rounded hover:bg-accent cursor-pointer"
                data-testid={`chat-input-knowledge-item-${entry.id}`}
              >
                <Checkbox
                  checked={selectedIds.has(entry.id)}
                  onCheckedChange={() => onToggle(entry.id)}
                />
                <span className="text-sm truncate" title={entry.name}>
                  {entry.name}
                </span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
