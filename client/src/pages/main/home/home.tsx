import { MessageCircle } from 'lucide-react';
import { HeroSection } from '@/components/home';
import { MainLayout } from '../layout';
import { useNavigate } from 'react-router';
import { createThread } from '@/api/server/chat';
import { uploadImage, type UploadProgress } from '@/api/server/chat/upload';
import { useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useHistory } from '@/hooks/useHistory';
import { useDialog } from '@/hooks/useDialog';

export function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { reload } = useHistory();
  const { openDialog } = useDialog();
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const draftThreadIdRef = useRef<string | null>(null);

  async function ensureDraftThread(): Promise<string> {
    if (draftThreadIdRef.current) {
      return draftThreadIdRef.current;
    }
    const { threadId } = await createThread();
    draftThreadIdRef.current = threadId;
    await reload();
    return threadId;
  }

  async function handleUploadImage(
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ) {
    const threadId = await ensureDraftThread();
    return uploadImage(threadId, file, onProgress);
  }

  async function handleSendMessage(message: string, imageUrls: string[]) {
    if (isCreatingThread) return;

    setIsCreatingThread(true);
    try {
      const threadId =
        draftThreadIdRef.current ?? (await createThread()).threadId;
      draftThreadIdRef.current = null;
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
      header={
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('mode_chat')}</span>
        </div>
      }
      content={
        <div className="h-full w-full px-4 py-4">
          <HeroSection
            onSendMessage={handleSendMessage}
            uploadImageFile={handleUploadImage}
          />
        </div>
      }
    />
  );
}
