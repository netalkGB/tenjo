import { useState, useRef, useEffect } from 'react';
import { MainLayout } from '../layout';
import { useTranslation } from '@/hooks/useTranslation';
import { useDialog } from '@/hooks/useDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Plus, Upload, Pencil, Trash2, FileUp } from 'lucide-react';
import { KnowledgeEditor } from '@/components/knowledge';
import { HistoryPagination } from '@/components/history/history-pagination';
import {
  getKnowledgeListPaginated,
  getKnowledgeContent,
  createKnowledge,
  uploadKnowledge,
  updateKnowledge,
  deleteKnowledge,
  type Knowledge as KnowledgeEntry
} from '@/api/server/knowledge';
import { KNOWLEDGE_MAX_FILE_SIZE } from '@/lib/knowledgeConstants';
import { useSettings } from '@/contexts/settings-context';

const PAGE_SIZE = 15;

function ensureTxtExtension(name: string): string {
  return name.endsWith('.txt') ? name : `${name}.txt`;
}

type ViewMode =
  | { type: 'list' }
  | { type: 'edit'; entry?: KnowledgeEntry; name: string; content: string };

function formatDate(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function Knowledge() {
  const { t } = useTranslation();
  const { openDialog, closeDialog } = useDialog();
  const { knowledgeList, reloadKnowledge } = useSettings();
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<ViewMode>({ type: 'list' });
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  async function loadEntries(page: number, search?: string) {
    setIsLoading(true);
    try {
      const result = await getKnowledgeListPaginated(
        page,
        PAGE_SIZE,
        search || undefined
      );
      setEntries(result.entries);
      setCurrentPage(result.currentPage);
      setTotalPages(result.totalPages);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_knowledge_load'),
        type: 'ok'
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    loadEntries(1);
  });

  // Debounced search — reset to page 1
  useEffect(() => {
    if (!initialized.current) return;

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      loadEntries(1, searchQuery);
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePageChange(page: number) {
    loadEntries(page, searchQuery || undefined);
  }

  function handleNew() {
    const dialogId = openDialog({
      title: t('knowledge_name'),
      content: <NamePrompt />,
      type: 'custom'
    });

    function NamePrompt() {
      const [nameValue, setNameValue] = useState('');
      return (
        <div className="space-y-4">
          <Input
            placeholder={t('knowledge_name_placeholder')}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            autoFocus
            data-testid="knowledge-name-dialog-input"
            onKeyDown={e => {
              if (e.key === 'Enter' && nameValue.trim()) {
                closeDialog(dialogId);
                setView({
                  type: 'edit',
                  name: nameValue.trim(),
                  content: ''
                });
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => closeDialog(dialogId)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={!nameValue.trim()}
              data-testid="knowledge-name-dialog-ok-button"
              onClick={() => {
                closeDialog(dialogId);
                setView({
                  type: 'edit',
                  name: nameValue.trim(),
                  content: ''
                });
              }}
            >
              OK
            </Button>
          </div>
        </div>
      );
    }
  }

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function processFile(file: File) {
    if (file.size > KNOWLEDGE_MAX_FILE_SIZE) {
      openDialog({
        title: t('error'),
        description: t('knowledge_file_too_large'),
        type: 'ok'
      });
      return;
    }

    const defaultName = file.name;
    const dialogId = openDialog({
      title: t('knowledge_name'),
      content: <UploadNamePrompt defaultName={defaultName} file={file} />,
      type: 'custom'
    });

    function UploadNamePrompt({
      defaultName,
      file
    }: {
      defaultName: string;
      file: File;
    }) {
      const [nameValue, setNameValue] = useState(defaultName);

      async function doUpload() {
        const safeName = ensureTxtExtension(nameValue.trim());
        if (knowledgeList.some(k => k.name === safeName)) {
          openDialog({
            title: t('error'),
            description: t('knowledge_duplicate_name'),
            type: 'ok'
          });
          return;
        }
        closeDialog(dialogId);
        try {
          await uploadKnowledge(nameValue.trim(), file);
          await loadEntries(currentPage, searchQuery || undefined);
          reloadKnowledge();
        } catch (error) {
          openDialog({
            title: t('error'),
            description:
              error instanceof Error
                ? error.message
                : t('error_knowledge_save'),
            type: 'ok'
          });
        }
      }

      return (
        <div className="space-y-4">
          <Input
            placeholder={t('knowledge_name_placeholder')}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            autoFocus
            data-testid="knowledge-upload-name-dialog-input"
            onKeyDown={e => {
              if (e.key === 'Enter' && nameValue.trim()) {
                doUpload();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => closeDialog(dialogId)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={!nameValue.trim()}
              onClick={doUpload}
              data-testid="knowledge-upload-name-dialog-ok-button"
            >
              {t('knowledge_upload')}
            </Button>
          </div>
        </div>
      );
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    processFile(file);
  }

  async function handleEdit(entry: KnowledgeEntry) {
    try {
      const content = await getKnowledgeContent(entry.id);
      setView({ type: 'edit', entry, name: entry.name, content });
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_knowledge_load'),
        type: 'ok'
      });
    }
  }

  function handleDelete(entry: KnowledgeEntry) {
    openDialog({
      title: t('knowledge_delete'),
      description: t('knowledge_delete_confirm'),
      type: 'ok/cancel',
      showCloseButton: false,
      onOk: async () => {
        try {
          await deleteKnowledge(entry.id);
          await loadEntries(currentPage, searchQuery || undefined);
          reloadKnowledge();
        } catch {
          openDialog({
            title: t('error'),
            description: t('error_knowledge_delete'),
            type: 'ok'
          });
        }
      }
    });
  }

  async function handleSave(name: string, content: string) {
    if (view.type !== 'edit') return;
    try {
      if (view.entry) {
        await updateKnowledge(view.entry.id, name, content);
      } else {
        const safeName = ensureTxtExtension(name);
        if (knowledgeList.some(k => k.name === safeName)) {
          openDialog({
            title: t('error'),
            description: t('knowledge_duplicate_name'),
            type: 'ok'
          });
          return;
        }
        await createKnowledge(name, content);
      }
      setView({ type: 'list' });
      await loadEntries(currentPage, searchQuery || undefined);
      reloadKnowledge();
    } catch (error) {
      openDialog({
        title: t('error'),
        description:
          error instanceof Error ? error.message : t('error_knowledge_save'),
        type: 'ok'
      });
    }
  }

  function handleCancel() {
    setView({ type: 'list' });
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  }

  if (view.type === 'edit') {
    return (
      <MainLayout
        header={<span className="text-sm">{t('knowledge')}</span>}
        content={
          <div className="h-full p-6">
            <KnowledgeEditor
              initialName={view.name}
              initialContent={view.content}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          </div>
        }
      />
    );
  }

  return (
    <MainLayout
      header={<span className="text-sm">{t('knowledge')}</span>}
      content={
        <div
          className={`max-w-3xl mx-auto px-6 py-6 space-y-4 relative min-h-full transition-colors ${isDragOver ? 'bg-primary/5' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10 border-2 border-dashed border-primary pointer-events-none">
              <div className="flex items-center gap-2 text-primary font-medium">
                <FileUp className="w-5 h-5" />
                <span>{t('knowledge_drop_here')}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              placeholder={t('knowledge_search')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1"
              data-testid="knowledge-search-input"
            />
            <Button
              variant="outline"
              onClick={handleNew}
              data-testid="knowledge-new-button"
            >
              <Plus className="size-4 mr-1" />
              {t('knowledge_new')}
            </Button>
            <Button
              variant="outline"
              onClick={handleUploadClick}
              data-testid="knowledge-upload-button"
            >
              <Upload className="size-4 mr-1" />
              {t('knowledge_upload')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={handleFileChange}
              data-testid="knowledge-file-input"
            />
          </div>

          {isLoading ? (
            <div className="space-y-1">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t('knowledge_no_entries')}
            </p>
          ) : (
            <div className="space-y-1">
              {entries.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                  data-testid={`knowledge-item-${entry.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm font-medium truncate"
                      data-testid={`knowledge-name-${entry.id}`}
                    >
                      {entry.name}
                    </p>
                    {entry.updated_at && (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(entry.updated_at)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(entry)}
                          data-testid={`knowledge-edit-button-${entry.id}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('knowledge_edit')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(entry)}
                          data-testid={`knowledge-delete-button-${entry.id}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('knowledge_delete')}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="pt-2">
              <HistoryPagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                skeleton={isLoading}
              />
            </div>
          )}
        </div>
      }
    />
  );
}
