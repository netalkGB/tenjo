type QueryValue = string | number | boolean;

export function urlPath(...segments: string[]): string {
  return `/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
}

export function urlPathWithQuery(
  path: string,
  query: Record<string, QueryValue>
): string {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    params.set(key, String(value));
  });

  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
