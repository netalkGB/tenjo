import ServiceLogo from '@/assets/service-logo.svg?react';
import { useBranding } from '@/contexts/branding-context';

interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className }: BrandLogoProps) {
  const { logoUrl } = useBranding();

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className={`${className ?? ''} select-none [-webkit-user-drag:none]`}
      />
    );
  }

  return <ServiceLogo className={className} />;
}
