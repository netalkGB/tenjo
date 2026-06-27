import { BrandLogo } from '@/components/common/brand-logo';
import { ChatInput } from '@/components/chat';
import { useSettings } from '@/contexts/settings-context';
import type { UploadProgress, UploadResponse } from '@/api/server/chat/upload';

interface HeroSectionProps {
  onSendMessage: (text: string, imageUrls: string[]) => void;
  uploadImageFile: (
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ) => Promise<UploadResponse>;
}

export function HeroSection({
  onSendMessage,
  uploadImageFile
}: HeroSectionProps) {
  const { selectedKnowledge, toggleKnowledge } = useSettings();

  return (
    <div className="relative top-[calc(15%)]">
      <div className="flex flex-col items-center justify-center">
        <BrandLogo className="h-25 w-auto" />
        <div className="mt-5 w-[90%] sm:w-full max-w-185">
          <ChatInput
            onSendMessage={onSendMessage}
            uploadImageFile={uploadImageFile}
            selectedKnowledge={selectedKnowledge}
            onToggleKnowledge={toggleKnowledge}
          />
        </div>
      </div>
    </div>
  );
}
