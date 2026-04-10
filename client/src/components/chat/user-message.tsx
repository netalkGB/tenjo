import { ReactNode } from 'react';

interface UserMessageProps {
  children: ReactNode;
}

export function UserMessage({ children }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <div
        className="bg-secondary text-secondary-foreground rounded-lg px-4 py-2 max-w-[85%] whitespace-pre-wrap select-text"
        data-testid="user-message-content"
      >
        {children}
      </div>
    </div>
  );
}
