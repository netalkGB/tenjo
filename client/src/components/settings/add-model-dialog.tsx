import { useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import { getAvailableModels } from '@/api/server/settings/models';
import type { AvailableModel, Model } from '@/api/server/settings/schemas';

const DEBOUNCE_MS = 1000;

interface AddModelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (model: {
    type: string;
    baseUrl: string;
    model: string;
    token?: string;
  }) => Promise<void>;
  existingModels: Model[];
}

export function AddModelDialog({
  isOpen,
  onClose,
  onAdd,
  existingModels
}: AddModelDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    type: 'lmstudio',
    baseUrl: '',
    model: '',
    token: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDuplicate =
    form.model !== '' &&
    existingModels.some(
      m => m.model === form.model && m.baseUrl === form.baseUrl
    );

  const resetForm = () => {
    setForm({ type: 'lmstudio', baseUrl: '', model: '', token: '' });
    setAvailableModels([]);
    setModelsFetched(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleAdd = async () => {
    if (!form.baseUrl || !form.model) return;
    setIsSubmitting(true);
    try {
      await onAdd({
        type: form.type,
        baseUrl: form.baseUrl,
        model: form.model,
        token: form.token || undefined
      });
      resetForm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchModels = async (baseUrl: string, token: string) => {
    if (!baseUrl) return;
    setIsFetchingModels(true);
    try {
      const models = await getAvailableModels(baseUrl, token || undefined);
      setAvailableModels(models);
      setModelsFetched(true);
    } catch {
      setAvailableModels([]);
      setModelsFetched(true);
    } finally {
      setIsFetchingModels(false);
    }
  };

  const scheduleFetch = (baseUrl: string, token: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (!baseUrl) return;
    debounceTimerRef.current = setTimeout(() => {
      fetchModels(baseUrl, token);
    }, DEBOUNCE_MS);
  };

  const handleBaseUrlChange = (value: string) => {
    setForm(prev => ({ ...prev, baseUrl: value, model: '' }));
    setAvailableModels([]);
    setModelsFetched(false);
    scheduleFetch(value, form.token);
  };

  const handleTokenChange = (value: string) => {
    setForm(prev => ({ ...prev, token: value, model: '' }));
    setAvailableModels([]);
    setModelsFetched(false);
    scheduleFetch(form.baseUrl, value);
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings_add_model')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('settings_provider')}</Label>
            <Select
              value={form.type}
              onValueChange={value =>
                setForm(prev => ({ ...prev, type: value }))
              }
            >
              <SelectTrigger data-testid="settings-model-add-provider-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lmstudio">LM Studio</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('settings_base_url')}</Label>
            <Input
              placeholder={
                form.type === 'ollama'
                  ? 'http://localhost:11434'
                  : 'http://localhost:1234/'
              }
              value={form.baseUrl}
              onChange={e => handleBaseUrlChange(e.target.value)}
              data-testid="settings-model-add-base-url-input"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('settings_token')}</Label>
            <Input
              type="password"
              placeholder={t('settings_token_placeholder')}
              value={form.token}
              onChange={e => handleTokenChange(e.target.value)}
              data-testid="settings-model-add-token-input"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('settings_model_name')}</Label>
            {isFetchingModels ? (
              <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('settings_fetching_models')}
              </div>
            ) : modelsFetched && availableModels.length > 0 ? (
              <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={comboboxOpen}
                    className="w-full justify-between font-normal"
                    data-testid="settings-model-add-model-name-combobox"
                  >
                    <span className="truncate">
                      {form.model || t('settings_select_model_placeholder')}
                    </span>
                    <ChevronsUpDown className="opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                  onWheel={e => e.stopPropagation()}
                >
                  <Command>
                    <CommandInput
                      placeholder={t('settings_search_model')}
                      className="h-9"
                    />
                    <CommandList>
                      <CommandEmpty>
                        {t('settings_no_models_found')}
                      </CommandEmpty>
                      <CommandGroup>
                        {availableModels.map(model => (
                          <CommandItem
                            key={model.id}
                            value={model.id}
                            onSelect={currentValue => {
                              setForm(prev => ({
                                ...prev,
                                model:
                                  currentValue === prev.model
                                    ? ''
                                    : currentValue
                              }));
                              setComboboxOpen(false);
                            }}
                          >
                            {model.id}
                            <Check
                              className={cn(
                                'ml-auto',
                                form.model === model.id
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              )}
                            />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <Input
                placeholder={t('settings_model_name')}
                value={form.model}
                disabled={!form.baseUrl}
                onChange={e =>
                  setForm(prev => ({ ...prev, model: e.target.value }))
                }
                data-testid="settings-model-add-model-name-input"
              />
            )}
            {modelsFetched && availableModels.length > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => {
                  setModelsFetched(false);
                  setAvailableModels([]);
                }}
                data-testid="settings-model-add-enter-manually-button"
              >
                {t('settings_enter_manually')}
              </button>
            )}
          </div>
          {isDuplicate && (
            <p className="text-sm text-destructive">
              {t('settings_model_duplicate')}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            data-testid="settings-model-add-cancel-button"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleAdd}
            disabled={
              !form.baseUrl || !form.model || isSubmitting || isDuplicate
            }
            data-testid="settings-model-add-submit-button"
          >
            {isSubmitting
              ? t('settings_adding_model')
              : t('settings_add_model')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
