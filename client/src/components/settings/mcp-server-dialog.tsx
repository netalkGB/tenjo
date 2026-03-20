import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
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
import type { McpServerConfig } from '@/api/server/settings';
import { KeyValueEditor } from './key-value-editor';
import {
  recordToEntries,
  entriesToRecord,
  type KeyValueEntry
} from './key-value-utils';
import { StringListEditor } from './string-list-editor';

interface McpServerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, config: McpServerConfig) => void;
  initialName?: string;
  initialConfig?: McpServerConfig;
}

type TransportType = 'stdio' | 'http';

export function McpServerDialog({
  isOpen,
  onClose,
  onSave,
  initialName,
  initialConfig
}: McpServerDialogProps) {
  const { t } = useTranslation();
  const isEditing = !!initialName;

  const [name, setName] = useState('');
  const [transportType, setTransportType] = useState<TransportType>('stdio');

  // stdio fields
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState<string[]>([]);
  const [envEntries, setEnvEntries] = useState<KeyValueEntry[]>([]);

  // http fields
  const [url, setUrl] = useState('');
  const [headerEntries, setHeaderEntries] = useState<KeyValueEntry[]>([]);

  useEffect(() => {
    if (isOpen) {
      if (initialConfig) {
        setTransportType(initialConfig.type);
        setName(initialName ?? '');

        if (initialConfig.type === 'stdio') {
          setCommand(initialConfig.command);
          setArgs(initialConfig.args ?? []);
          setEnvEntries(recordToEntries(initialConfig.env));
          setUrl('');
          setHeaderEntries([]);
        } else {
          setUrl(initialConfig.url);
          setHeaderEntries(recordToEntries(initialConfig.headers));
          setCommand('');
          setArgs([]);
          setEnvEntries([]);
        }
      } else {
        resetForm();
      }
    }
  }, [isOpen, initialName, initialConfig]);

  const resetForm = () => {
    setName('');
    setTransportType('stdio');
    setCommand('');
    setArgs([]);
    setEnvEntries([]);
    setUrl('');
    setHeaderEntries([]);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    if (transportType === 'stdio') {
      if (!command.trim()) return;
      const config: McpServerConfig = {
        type: 'stdio',
        command: command.trim(),
        args: args.filter(a => a.trim() !== ''),
        env: entriesToRecord(envEntries)
      };
      onSave(trimmedName, config);
    } else {
      if (!url.trim()) return;
      const config: McpServerConfig = {
        type: 'http',
        url: url.trim(),
        headers: entriesToRecord(headerEntries)
      };
      onSave(trimmedName, config);
    }

    resetForm();
  };

  const isValid =
    name.trim() !== '' &&
    (transportType === 'stdio' ? command.trim() !== '' : url.trim() !== '');

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? t('settings_mcp_edit_server')
              : t('settings_mcp_add_server')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('settings_mcp_server_name')}</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isEditing}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('settings_mcp_transport_type')}</Label>
            <Select
              value={transportType}
              onValueChange={value => setTransportType(value as TransportType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">Stdio</SelectItem>
                <SelectItem value="http">HTTP (Streamable)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {transportType === 'stdio' && (
            <>
              <div className="space-y-2">
                <Label>{t('settings_mcp_command')}</Label>
                <Input
                  value={command}
                  onChange={e => setCommand(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('settings_mcp_args')}</Label>
                <StringListEditor items={args} onChange={setArgs} />
              </div>

              <div className="space-y-2">
                <Label>{t('settings_mcp_env')}</Label>
                <KeyValueEditor entries={envEntries} onChange={setEnvEntries} />
              </div>
            </>
          )}

          {transportType === 'http' && (
            <>
              <div className="space-y-2">
                <Label>{t('settings_mcp_url')}</Label>
                <Input
                  placeholder={t('settings_mcp_url_placeholder')}
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('settings_mcp_headers')}</Label>
                <KeyValueEditor
                  entries={headerEntries}
                  onChange={setHeaderEntries}
                  keyPlaceholder={t('settings_mcp_header_key_placeholder')}
                  valuePlaceholder={t('settings_mcp_header_value_placeholder')}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {isEditing ? t('save') : t('settings_mcp_add_server')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
