import { HeroSection } from '@/components/home';
import { MainLayout } from '../layout';
import { useNavigate } from 'react-router';
import { createThread } from '@/api/server/chat';
import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useHistory } from '@/hooks/useHistory';
import { useDialog } from '@/hooks/useDialog';

export function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { reload } = useHistory();
  const { openDialog } = useDialog();
  const [isCreatingThread, setIsCreatingThread] = useState(false);

  async function handleSendMessage(message: string, imageUrls: string[]) {
    if (isCreatingThread) return;

    setIsCreatingThread(true);
    try {
      const { threadId } = await createThread();
      await reload();
      navigate(`/chat/${threadId}`, {
        state: {
          initialMessage: message,
          initialImageUrls: imageUrls.length > 0 ? imageUrls : undefined
        }
      });
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_create_thread'),
        type: 'ok'
      });
      setIsCreatingThread(false);
    }
  }

  return (
    <MainLayout
      header={<span className="text-sm">{t('app_name')}</span>}
      content={
        <div className="h-full w-full px-4 py-4">
          <HeroSection onSendMessage={handleSendMessage} />
        </div>
      }
    />
  );
}
