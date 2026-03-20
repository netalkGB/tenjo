import { useTranslation } from '@/hooks/useTranslation';
import { useState, useEffect, useRef } from 'react';
import {
  getInvitationCodes,
  createInvitationCode,
  deleteInvitationCode,
  getUsers,
  deleteUser,
  type InvitationCode,
  type UserRole,
  type UserItem
} from '@/api/server/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2, Plus, Copy, Check, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useDialog } from '@/hooks/useDialog';

function UserListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-full rounded-md" />
      {[1, 2, 3].map(i => (
        <div key={i} className="flex items-center justify-between py-2">
          <div className="flex gap-8 flex-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}

function InvitationCodeListSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2].map(i => (
        <div
          key={i}
          className="flex items-center justify-between border rounded-lg p-4"
        >
          <div className="space-y-2">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}

export function UserSettings() {
  const { t } = useTranslation();
  const { openDialog, closeDialog } = useDialog();

  const [userList, setUserList] = useState<UserItem[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');

  const [invitationCodes, setInvitationCodes] = useState<InvitationCode[]>([]);
  const [invitationCodesLoaded, setInvitationCodesLoaded] = useState(false);
  const [newCodeRole, setNewCodeRole] = useState<UserRole>('standard');
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    loadUsers();
    loadInvitationCodes();
  });

  const loadUsers = async () => {
    try {
      const response = await getUsers();
      setUserList(response.users);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_load_users'),
        type: 'ok'
      });
    } finally {
      setUsersLoaded(true);
    }
  };

  const handleDeleteUser = (id: string, userName: string) => {
    const dialogId = openDialog({
      type: 'cancel/ok',
      title: t('settings_users_delete_title'),
      description: t('settings_users_delete_message', { userName }),
      okText: t('delete'),
      cancelText: t('cancel'),
      showCloseButton: false,
      closeOnOutsideClick: false,
      onOk: async () => {
        closeDialog(dialogId);
        try {
          await deleteUser(id);
          await loadUsers();
        } catch {
          openDialog({
            title: t('error'),
            description: t('error_delete_user'),
            type: 'ok'
          });
        }
      },
      onCancel: () => {
        closeDialog(dialogId);
      }
    });
  };

  const loadInvitationCodes = async () => {
    try {
      const response = await getInvitationCodes();
      setInvitationCodes(response.codes);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_load_invitation_codes'),
        type: 'ok'
      });
    } finally {
      setInvitationCodesLoaded(true);
    }
  };

  const handleCreateInvitationCode = async () => {
    try {
      await createInvitationCode(newCodeRole);
      await loadInvitationCodes();
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_create_invitation_code'),
        type: 'ok'
      });
    }
  };

  const handleDeleteInvitationCode = (id: string) => {
    const dialogId = openDialog({
      type: 'cancel/ok',
      title: t('settings_invitation_delete_title'),
      description: t('settings_invitation_delete_message'),
      okText: t('delete'),
      cancelText: t('cancel'),
      showCloseButton: false,
      closeOnOutsideClick: false,
      onOk: async () => {
        closeDialog(dialogId);
        try {
          await deleteInvitationCode(id);
          await loadInvitationCodes();
        } catch {
          openDialog({
            title: t('error'),
            description: t('error_delete_invitation_code'),
            type: 'ok'
          });
        }
      },
      onCancel: () => {
        closeDialog(dialogId);
      }
    });
  };

  const handleCopyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const filteredUsers = userList.filter(user => {
    if (!userSearchQuery) return true;
    const q = userSearchQuery.toLowerCase();
    return (
      user.fullName.toLowerCase().includes(q) ||
      user.userName.toLowerCase().includes(q) ||
      user.email.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings_users')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!usersLoaded && <UserListSkeleton />}

          {usersLoaded && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={t('settings_users_search')}
                  value={userSearchQuery}
                  onChange={e => setUserSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {filteredUsers.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {t('settings_users_no_users')}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('settings_users_name')}</TableHead>
                      <TableHead>{t('settings_users_username')}</TableHead>
                      <TableHead>{t('settings_users_email')}</TableHead>
                      <TableHead className="w-12.5" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map(user => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {user.fullName || (
                              <span className="text-muted-foreground">
                                {t('settings_users_name_unset')}
                              </span>
                            )}
                            {user.userRole === 'admin' && (
                              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                                {t('settings_role_admin')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{user.userName}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  handleDeleteUser(user.id, user.userName)
                                }
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('delete')}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('settings_invitation_codes')}</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={newCodeRole}
              onValueChange={v => setNewCodeRole(v as UserRole)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">
                  {t('settings_role_admin')}
                </SelectItem>
                <SelectItem value="standard">
                  {t('settings_role_standard')}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateInvitationCode}
              disabled={!invitationCodesLoaded}
            >
              <Plus className="size-4 mr-1" />
              {t('settings_invitation_generate')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!invitationCodesLoaded && <InvitationCodeListSkeleton />}

          {invitationCodesLoaded && invitationCodes.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-8">
              {t('settings_invitation_no_codes')}
            </p>
          )}

          {invitationCodesLoaded &&
            invitationCodes.map(code => (
              <div
                key={code.id}
                className="flex items-center justify-between border rounded-lg p-4"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="font-mono text-sm truncate">{code.code}</div>
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                      {code.userRole === 'admin'
                        ? t('settings_role_admin')
                        : t('settings_role_standard')}
                    </span>
                    {code.used && (
                      <span className="inline-flex items-center rounded-md bg-destructive/10 text-destructive px-2 py-0.5 text-xs font-medium">
                        {t('settings_invitation_used')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 ml-2">
                  {!code.used && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopyCode(code.code, code.id)}
                        >
                          {copiedCodeId === code.id ? (
                            <Check className="size-4" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('copy')}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteInvitationCode(code.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('delete')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
    </>
  );
}
