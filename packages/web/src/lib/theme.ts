export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];

/** Same key as the inline script in index.html, which applies the theme before first paint. */
const KEY = "squad.theme";

export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v as Theme) ? (v as Theme) : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // storage disabled: the choice lasts until reload
  }
}

/** "system" leaves the choice to prefers-color-scheme; light or dark pins it. */
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = t;
}
