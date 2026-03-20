import { useTranslation } from '@/hooks/useTranslation';
import { useState } from 'react';
import { addModel, deleteModel } from '@/api/server/settings';
import { formatProviderLabel } from '@/lib/providerLabels';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2, Plus, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useDialog } from '@/hooks/useDialog';
import { useUser } from '@/hooks/useUser';
import { useSettings } from '@/contexts/settings-context';
import { AddModelDialog } from '@/components/settings/add-model-dialog';

function ModelListSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className="flex items-center justify-between border rounded-lg p-4"
        >
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-60" />
          </div>
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}

export function ModelSettings() {
  const { t } = useTranslation();
  const { openDialog, closeDialog } = useDialog();
  const { userRole, singleUserMode } = useUser();
  const { models, isLoaded, reloadModels } = useSettings();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const isAdmin = userRole === 'admin';

  const handleAdd = async (model: {
    type: string;
    baseUrl: string;
    model: string;
    token?: string;
  }) => {
    try {
      await addModel(model);
      await reloadModels();
      setIsAddDialogOpen(false);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_add_model'),
        type: 'ok'
      });
    }
  };

  const handleDelete = (id: string) => {
    const dialogId = openDialog({
      type: 'cancel/ok',
      title: t('settings_delete_model_title'),
      description: t('settings_delete_model_message'),
      okText: t('delete'),
      cancelText: t('cancel'),
      showCloseButton: false,
      closeOnOutsideClick: false,
      onOk: async () => {
        closeDialog(dialogId);
        try {
          await deleteModel(id);
          await reloadModels();
        } catch {
          openDialog({
            title: t('error'),
            description: t('error_delete_model'),
            type: 'ok'
          });
        }
      },
      onCancel: () => {
        closeDialog(dialogId);
      }
    });
  };

  return (
    <>
      {!singleUserMode && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3">
          <Info className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            <p>{t('settings_shared_settings_description')}</p>
            {!isAdmin && (
              <p className="mt-1">{t('settings_shared_readonly')}</p>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('settings_models')}</CardTitle>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddDialogOpen(true)}
              disabled={!isLoaded}
            >
              <Plus className="size-4 mr-1" />
              {t('settings_add_model')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLoaded && <ModelListSkeleton />}

          {isLoaded && models.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-8">
              {isAdmin
                ? t('settings_no_models')
                : t('settings_no_models_readonly')}
            </p>
          )}

          {isLoaded &&
            models.map(model => (
              <div
                key={model.id}
                className="flex items-center justify-between border rounded-lg p-4"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="font-medium">{model.model}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium mr-2">
                      {formatProviderLabel(model.type)}
                    </span>
                    {model.baseUrl}
                  </div>
                </div>
                {isAdmin && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(model.id)}
                        className="ml-2"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('delete')}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            ))}
        </CardContent>
      </Card>

      {isAdmin && (
        <AddModelDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          onAdd={handleAdd}
          existingModels={models}
        />
      )}
    </>
  );
}
