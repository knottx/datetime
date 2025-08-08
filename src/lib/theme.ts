import { readJson, writeJson } from './storage.ts';

export type ThemePreference = 'system' | 'light' | 'dark';

// Read by the inline script in index.html before first paint.
const STORAGE_KEY = 'datetime:theme';
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const parseTheme = (value: unknown): ThemePreference =>
  THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system';

function apply(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && darkQuery.matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0a' : '#fafafa');
}

/** Wires the Light / System / Dark radio group (`input[name="theme"]`). */
export function initTheme(): void {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="theme"]'));
  let preference = readJson(STORAGE_KEY, parseTheme, 'system');

  const render = (): void => {
    for (const input of inputs) input.checked = input.value === preference;
    apply(preference);
  };

  for (const input of inputs) {
    input.addEventListener('change', () => {
      preference = parseTheme(input.value);
      writeJson(STORAGE_KEY, preference);
      render();
    });
  }

  darkQuery.addEventListener('change', () => {
    if (preference === 'system') apply(preference);
  });

  // Keep multiple open tabs in sync.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    preference = readJson(STORAGE_KEY, parseTheme, 'system');
    render();
  });

  render();
}
