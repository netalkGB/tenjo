import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { KNOWLEDGE_MAX_FILE_SIZE } from '@/lib/knowledgeConstants';

interface KnowledgeEditorProps {
  initialName: string;
  initialContent: string;
  onSave: (name: string, content: string) => Promise<void>;
  onCancel: () => void;
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function KnowledgeEditor({
  initialName,
  initialContent,
  onSave,
  onCancel
}: KnowledgeEditorProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);

  const contentBytes = new TextEncoder().encode(content).length;
  const isOverLimit = contentBytes > KNOWLEDGE_MAX_FILE_SIZE;
  const canSave = name.trim().length > 0 && !isOverLimit && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await onSave(name.trim(), content);
    } finally {
      setIsSaving(false);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <Input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={t('knowledge_name_placeholder')}
        data-testid="knowledge-editor-name-input"
      />
      <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
        <Editor
          language="plaintext"
          theme={isDarkMode() ? 'vs-dark' : 'vs'}
          value={content}
          onChange={value => setContent(value ?? '')}
          options={{
            minimap: { enabled: false },
            wordWrap: 'on',
            scrollBeyondLastLine: false
          }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span
          className={`text-xs ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
        >
          {formatSize(contentBytes)} / {formatSize(KNOWLEDGE_MAX_FILE_SIZE)}
          {isOverLimit && ` — ${t('knowledge_file_too_large')}`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            data-testid="knowledge-editor-cancel-button"
          >
            {t('knowledge_cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            data-testid="knowledge-editor-save-button"
          >
            {isSaving ? t('saving') : t('knowledge_save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
