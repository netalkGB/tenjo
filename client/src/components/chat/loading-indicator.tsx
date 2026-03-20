import { useTranslation } from '@/hooks/useTranslation';

export function LoadingIndicator() {
  const { t } = useTranslation();

  return (
    <div className="mt-4 mb-4 animate-caret-blink text-muted-foreground">
      {t('please_wait')}
    </div>
  );
}
