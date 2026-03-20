import { MainLayout } from '../layout';
import { useTranslation } from '@/hooks/useTranslation';
import { useState } from 'react';
import { User, Cpu, Wrench, Users, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useUser } from '@/hooks/useUser';
import { ProfileSettings } from '@/components/settings/profile-settings';
import { ModelSettings } from '@/components/settings/model-settings';
import { ToolsMcpSettings } from '@/components/settings/tools-mcp-settings';
import { UserSettings } from '@/components/settings/user-settings';
import { LicenseSettings } from '@/components/settings/license-settings';

type SettingsCategory =
  | 'profile'
  | 'models'
  | 'tools-mcp'
  | 'users'
  | 'licenses';

const categoryIcons: Record<SettingsCategory, typeof User> = {
  profile: User,
  models: Cpu,
  'tools-mcp': Wrench,
  users: Users,
  licenses: ScrollText
};

const categoryI18nKeys = {
  profile: 'settings_category_profile',
  models: 'settings_category_models',
  'tools-mcp': 'settings_category_tools_mcp',
  users: 'settings_category_users',
  licenses: 'settings_category_licenses'
} as const;

function getSettingsCategories(
  singleUserMode: boolean,
  isAdmin: boolean
): SettingsCategory[] {
  if (singleUserMode) {
    return ['models', 'tools-mcp', 'licenses'];
  }
  if (isAdmin) {
    return ['profile', 'models', 'tools-mcp', 'users', 'licenses'];
  }
  return ['profile', 'models', 'tools-mcp', 'licenses'];
}

function SettingsCategoryContent({ category }: { category: SettingsCategory }) {
  switch (category) {
    case 'profile':
      return <ProfileSettings />;
    case 'models':
      return <ModelSettings />;
    case 'tools-mcp':
      return <ToolsMcpSettings />;
    case 'users':
      return <UserSettings />;
    case 'licenses':
      return <LicenseSettings />;
  }
}

export function Settings() {
  const { t } = useTranslation();
  const { userRole, singleUserMode } = useUser();
  const isAdmin = userRole === 'admin';

  const categories = getSettingsCategories(singleUserMode, isAdmin);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(
    categories[0]
  );

  return (
    <MainLayout
      header={<span className="text-sm">{t('settings')}</span>}
      content={
        <div className="flex h-full">
          <nav className="w-64 shrink-0 border-r">
            <div className="flex flex-col gap-1 p-4">
              {categories.map(category => {
                const Icon = categoryIcons[category];
                const isActive = activeCategory === category;
                return (
                  <Button
                    key={category}
                    variant={isActive ? 'secondary' : 'ghost'}
                    className="justify-start gap-2"
                    onClick={() => setActiveCategory(category)}
                  >
                    <Icon className="size-4" />
                    {t(categoryI18nKeys[category])}
                  </Button>
                );
              })}
            </div>
          </nav>

          <Separator orientation="vertical" className="hidden" />

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
              <SettingsCategoryContent category={activeCategory} />
            </div>
          </div>
        </div>
      }
    />
  );
}
