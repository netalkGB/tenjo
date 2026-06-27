import { webSocketUrl } from '@/lib/webSocketUrl';

export function csrfWebSocketUrl(path: string): string {
  const url = new URL(webSocketUrl(path));
  const token = document.body.dataset.csrfToken;
  if (token) {
    url.searchParams.set('_csrf', token);
  }
  return url.toString();
}
