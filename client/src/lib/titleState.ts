export function isTitlePending(title: string | null | undefined): boolean {
  return !title || title === '-';
}
