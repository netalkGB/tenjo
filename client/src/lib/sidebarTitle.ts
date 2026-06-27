export function isUnnamedTitle(title: string | null | undefined): boolean {
  return !title || title.trim().length === 0 || title === '-';
}
