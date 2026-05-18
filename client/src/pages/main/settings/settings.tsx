import { MainLayout } from '../layout';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Settings2,
  User,
  Cpu,
  Wrench,
  Users,
  ScrollText,
  ImageIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useUser } from '@/hooks/useUser';
import { ProfileSettings } from '@/components/settings/profile-settings';
import { ModelSettings } from '@/components/settings/model-settings';
import { ToolsMcpSettings } from '@/components/settings/tools-mcp-settings';
import { UserSettings } from '@/components/settings/user-settings';
import { LicenseSettings } from '@/components/settings/license-settings';
import { GeneralSettings } from '@/components/settings/general-settings';
import { BrandingSettings } from '@/components/settings/branding-settings';
import { useParams, useNavigate } from 'react-router';

type SettingsCategory =
  | 'general'
  | 'profile'
  | 'models'
  | 'tools-mcp'
  | 'users'
  | 'branding'
  | 'licenses';

const categoryIcons: Record<SettingsCategory, typeof User> = {
  general: Settings2,
  profile: User,
  models: Cpu,
  'tools-mcp': Wrench,
  users: Users,
  branding: ImageIcon,
  licenses: ScrollText
};

const categoryI18nKeys = {
  general: 'settings_category_general',
  profile: 'settings_category_profile',
  models: 'settings_category_models',
  'tools-mcp': 'settings_category_tools_mcp',
  users: 'settings_category_users',
  branding: 'settings_category_branding',
  licenses: 'settings_category_licenses'
} as const;

function getSettingsCategories(
  singleUserMode: boolean,
  isAdmin: boolean
): SettingsCategory[] {
  if (singleUserMode) {
    return ['general', 'models', 'tools-mcp', 'licenses'];
  }
  if (isAdmin) {
    return [
      'general',
      'profile',
      'models',
      'tools-mcp',
      'users',
      'branding',
      'licenses'
    ];
  }
  return ['general', 'profile', 'models', 'tools-mcp', 'licenses'];
}

function isSettingsCategory(value: string): value is SettingsCategory {
  return [
    'general',
    'profile',
    'models',
    'tools-mcp',
    'users',
    'branding',
    'licenses'
  ].includes(value);
}

function SettingsCategoryContent({ category }: { category: SettingsCategory }) {
  switch (category) {
    case 'general':
      return <GeneralSettings />;
    case 'profile':
      return <ProfileSettings />;
    case 'models':
      return <ModelSettings />;
    case 'tools-mcp':
      return <ToolsMcpSettings />;
    case 'users':
      return <UserSettings />;
    case 'branding':
      return <BrandingSettings />;
    case 'licenses':
      return <LicenseSettings />;
  }
}

export function Settings() {
  const { t } = useTranslation();
  const { userRole, singleUserMode } = useUser();
  const isAdmin = userRole === 'admin';
  const navigate = useNavigate();
  const { category: categoryParam } = useParams<{ category: string }>();

  const categories = getSettingsCategories(singleUserMode, isAdmin);
  const activeCategory: SettingsCategory =
    categoryParam &&
    isSettingsCategory(categoryParam) &&
    categories.includes(categoryParam)
      ? categoryParam
      : categories[0];

  return (
    <MainLayout
      header={
        <span className="text-sm" data-testid="settings-title">
          {t('settings')}
        </span>
      }
      content={
        <div className="flex h-full">
          <nav className="w-14 shrink-0 border-r md:w-64">
            <div className="flex flex-col gap-1 p-2 md:p-4">
              {categories.map(category => {
                const Icon = categoryIcons[category];
                const isActive = activeCategory === category;
                const label = t(categoryI18nKeys[category]);
                return (
                  <Tooltip key={category}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isActive ? 'secondary' : 'ghost'}
                        className="justify-center gap-2 px-0 md:justify-start md:px-3"
                        onClick={() => navigate(`/settings/${category}`)}
                        aria-label={label}
                        data-testid={`settings-nav-${category}`}
                      >
                        <Icon className="size-4" />
                        <span className="hidden md:inline">{label}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="md:hidden">
                      {label}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </nav>

          <Separator orientation="vertical" className="hidden" />

          <div className="flex-1 min-w-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-4 space-y-6 md:px-6 md:py-6">
              <SettingsCategoryContent category={activeCategory} />
            </div>
          </div>
        </div>
      }
    />
  );
}
