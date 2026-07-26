import { useState, useRef, useEffect } from 'react';
import { MainLayout } from '../layout';
import { useTranslation } from '@/hooks/useTranslation';
import { useDialog } from '@/hooks/useDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Upload, Trash2, FileUp } from 'lucide-react';
import { HistoryPagination } from '@/components/history/history-pagination';
import {
  listPunchSkillsPaginated,
  importPunchSkill,
  setPunchSkillEnabled,
  deletePunchSkill,
  type PunchSkill,
  type PunchSkillEnabledFilter
} from '@/api/server/punch';
import { ApiError } from '@/api/errors/ApiError';

const ZIP_MAX_SIZE = 5 * 1024 * 1024;
const PAGE_SIZE = 15;

export function Punch() {
  const { t } = useTranslation();
  const { openDialog, closeDialog } = useDialog();
  const [skills, setSkills] = useState<PunchSkill[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [enabledFilter, setEnabledFilter] =
    useState<PunchSkillEnabledFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);
  const searchQueryRef = useRef(searchQuery);
  const enabledFilterRef = useRef(enabledFilter);
  searchQueryRef.current = searchQuery;
  enabledFilterRef.current = enabledFilter;

  async function loadSkills(
    page: number,
    search?: string,
    enabled?: PunchSkillEnabledFilter
  ) {
    setIsLoading(true);
    try {
      const result = await listPunchSkillsPaginated(page, PAGE_SIZE, {
        search: search || undefined,
        enabled: enabled ?? enabledFilterRef.current
      });
      setSkills(result.skills);
      setCurrentPage(result.currentPage);
      setTotalPages(result.totalPages);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_punch_load'),
        type: 'ok'
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    loadSkills(1);
  });

  // Debounced search; skip the mount pass (init effect already loads page 1).
  const skipSearchEffect = useRef(true);
  useEffect(() => {
    if (skipSearchEffect.current) {
      skipSearchEffect.current = false;
      return;
    }

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      loadSkills(1, searchQuery, enabledFilterRef.current);
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when the enabled filter changes; skip the mount pass.
  const skipEnabledFilterEffect = useRef(true);
  useEffect(() => {
    if (skipEnabledFilterEffect.current) {
      skipEnabledFilterEffect.current = false;
      return;
    }
    loadSkills(1, searchQueryRef.current, enabledFilter);
  }, [enabledFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePageChange(page: number) {
    loadSkills(page, searchQuery || undefined, enabledFilter);
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function processZip(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      openDialog({
        title: t('error'),
        description: t('punch_import_zip_only'),
        type: 'ok'
      });
      return;
    }
    if (file.size > ZIP_MAX_SIZE) {
      openDialog({
        title: t('error'),
        description: t('punch_file_too_large'),
        type: 'ok'
      });
      return;
    }

    setImporting(true);
    try {
      await importPunchSkill(file);
      await loadSkills(currentPage, searchQuery || undefined, enabledFilter);
    } catch (error) {
      const description =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('error_punch_import');
      openDialog({
        title: t('error'),
        description,
        type: 'ok'
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void processZip(file);
  }

  async function handleToggle(skill: PunchSkill, enabled: boolean) {
    try {
      const updated = await setPunchSkillEnabled(skill.id, enabled);
      if (
        (enabledFilter === 'enabled' && !updated.enabled) ||
        (enabledFilter === 'disabled' && updated.enabled)
      ) {
        await loadSkills(currentPage, searchQuery || undefined, enabledFilter);
        return;
      }
      setSkills(prev => prev.map(s => (s.id === updated.id ? updated : s)));
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_punch_toggle'),
        type: 'ok'
      });
    }
  }

  function handleDelete(skill: PunchSkill) {
    const dialogId = openDialog({
      type: 'cancel/ok',
      title: t('punch_delete_title'),
      description: t('punch_delete_confirm', { name: skill.name }),
      okText: t('delete'),
      cancelText: t('cancel'),
      onOk: () => {
        closeDialog(dialogId);
        void (async () => {
          try {
            await deletePunchSkill(skill.id);
            await loadSkills(
              currentPage,
              searchQuery || undefined,
              enabledFilter
            );
          } catch {
            openDialog({
              title: t('error'),
              description: t('error_punch_delete'),
              type: 'ok'
            });
          }
        })();
      }
    });
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
    if (file) void processZip(file);
  }

  return (
    <MainLayout
      header={<span className="text-sm">{t('punch')}</span>}
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
                <span>{t('punch_drop_hint')}</span>
              </div>
            </div>
          )}

          <p
            className="text-sm text-muted-foreground"
            data-testid="punch-description"
          >
            {t('punch_description')}
          </p>

          <div className="flex items-center gap-2">
            <Input
              placeholder={t('punch_search')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1"
              data-testid="punch-search-input"
            />
            <Button
              variant="outline"
              onClick={handleImportClick}
              disabled={importing}
              data-testid="punch-import-button"
            >
              <Upload className="size-4 mr-1" />
              {importing ? t('punch_importing') : t('punch_import')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={handleFileChange}
              data-testid="punch-file-input"
            />
          </div>

          <Tabs
            value={enabledFilter}
            onValueChange={value =>
              setEnabledFilter(value as PunchSkillEnabledFilter)
            }
            data-testid="punch-enabled-filter"
          >
            <TabsList>
              <TabsTrigger value="all" data-testid="punch-filter-all">
                {t('punch_filter_all')}
              </TabsTrigger>
              <TabsTrigger value="enabled" data-testid="punch-filter-enabled">
                {t('punch_filter_enabled')}
              </TabsTrigger>
              <TabsTrigger value="disabled" data-testid="punch-filter-disabled">
                {t('punch_filter_disabled')}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {isLoading ? (
            <div className="space-y-1">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </div>
              ))}
            </div>
          ) : skills.length === 0 ? (
            <p
              className="text-sm text-muted-foreground text-center py-8"
              data-testid="punch-empty"
            >
              {t('punch_empty')}
            </p>
          ) : (
            <div className="space-y-1">
              {skills.map(skill => (
                <div
                  key={skill.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                  data-testid={`punch-skill-${skill.name}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        data-testid={`punch-skill-name-${skill.name}`}
                      >
                        {skill.name}
                      </p>
                      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        /{skill.name}
                      </code>
                    </div>
                    {skill.description ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {skill.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <label className="flex shrink-0 items-center gap-2 text-sm px-2">
                      <span className="text-muted-foreground text-xs">
                        {skill.enabled
                          ? t('punch_enabled')
                          : t('punch_disabled')}
                      </span>
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={skill.enabled}
                        onChange={e =>
                          void handleToggle(skill, e.target.checked)
                        }
                        data-testid={`punch-skill-toggle-${skill.name}`}
                      />
                    </label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(skill)}
                          data-testid={`punch-skill-delete-${skill.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('delete')}</TooltipContent>
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
