export type ThemeMode = 'auto' | 'light' | 'dark';

const THEME_MODES: readonly ThemeMode[] = ['auto', 'light', 'dark'] as const;
export { THEME_MODES };

/**
 * Applies the given theme mode to the document.
 */
export function applyTheme(mode: ThemeMode): void {
  const isDark =
    mode === 'dark' ||
    (mode === 'auto' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.toggle('dark', isDark);
}
