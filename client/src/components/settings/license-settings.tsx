import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';

export function LicenseSettings() {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const load = async () => {
      const res = await fetch('/license-report.txt');
      const contentType = res.headers.get('content-type') ?? '';
      if (res.ok && contentType.includes('text/plain')) {
        setContent(await res.text());
      } else {
        setNotFound(true);
      }
    };

    load();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings_licenses_title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {notFound ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Info className="size-4 shrink-0" />
            <span>{t('settings_licenses_not_generated')}</span>
          </div>
        ) : (
          <pre className="h-[calc(100vh-280px)] w-full overflow-auto rounded bg-muted p-4 text-xs whitespace-pre-wrap">
            {content ?? ''}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
