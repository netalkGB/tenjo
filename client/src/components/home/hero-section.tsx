import ServiceLogo from '@/assets/service-logo.svg?react';
import { ChatInput } from '@/components/chat';
import { useSettings } from '@/contexts/settings-context';

interface HeroSectionProps {
  onSendMessage: (text: string, imageUrls: string[]) => void;
}

export function HeroSection({ onSendMessage }: HeroSectionProps) {
  const { selectedKnowledge, toggleKnowledge } = useSettings();

  return (
    <div className="relative top-[calc(15%)]">
      <div className="flex flex-col items-center justify-center">
        <ServiceLogo className="h-25 w-auto" />
        <div className="mt-5 w-[90%] md:w-125 lg:w-185">
          <ChatInput
            onSendMessage={onSendMessage}
            selectedKnowledge={selectedKnowledge}
            onToggleKnowledge={toggleKnowledge}
          />
        </div>
      </div>
    </div>
  );
}
