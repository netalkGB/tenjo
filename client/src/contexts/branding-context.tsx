import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode
} from 'react';
import { getBranding } from '@/api/server/settings';

const DEFAULT_APP_TITLE = 'Tenjo';
const DEFAULT_FAVICON_HREF = '/logo.svg';

interface BrandingState {
  appTitle: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
}

interface BrandingContextValue extends BrandingState {
  reloadBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

function applyDocumentTitle(appTitle: string | null) {
  document.title = appTitle && appTitle.trim() ? appTitle : DEFAULT_APP_TITLE;
}

function applyFavicon(faviconUrl: string | null) {
  const href = faviconUrl ?? DEFAULT_FAVICON_HREF;
  // Some pages may not have a pre-existing icon link; create one if needed.
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  // Drop the type attribute so the browser infers from the file extension
  // (custom uploads are PNG/JPEG; default is SVG).
  link.removeAttribute('type');
  link.href = href;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingState>({
    appTitle: null,
    logoUrl: null,
    faviconUrl: null
  });

  const reloadBranding = async () => {
    try {
      const data = await getBranding();
      setBranding({
        appTitle: data.appTitle,
        logoUrl: data.logoUrl,
        faviconUrl: data.faviconUrl
      });
    } catch {
      // Branding is non-critical; fall back to defaults baked into index.html
    }
  };

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    reloadBranding();
  });

  useEffect(() => {
    applyDocumentTitle(branding.appTitle);
  }, [branding.appTitle]);

  useEffect(() => {
    applyFavicon(branding.faviconUrl);
  }, [branding.faviconUrl]);

  return (
    <BrandingContext.Provider value={{ ...branding, reloadBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBranding() {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding must be used within BrandingProvider');
  }
  return context;
}
