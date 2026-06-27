type WebSocketUrlLocation = Pick<Location, 'host' | 'protocol'>;

export function webSocketUrl(
  path: string,
  location: WebSocketUrlLocation = window.location
): string {
  const url = new URL(
    path.startsWith('/') ? path : `/${path}`,
    `${location.protocol}//${location.host}`
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
