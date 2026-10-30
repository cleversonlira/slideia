import { useEffect, useState } from "react";

/** Interface theme of the editor (not of the slides). "system" follows the OS setting. */
export type UiTheme = "system" | "light" | "dark";

const KEY = "slideia-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function savedTheme(): UiTheme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function setTheme(theme: UiTheme): void {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked (private mode): the choice lasts until the page is reloaded.
  }
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event("slideia-theme"));
}

/** Theme actually shown right now ("system" resolved to light or dark). */
export function useEffectiveTheme(): "light" | "dark" {
  const read = () => {
    const t = savedTheme();
    return t === "system" ? (media().matches ? "dark" : "light") : t;
  };
  const [theme, set] = useState(read);
  useEffect(() => {
    const update = () => set(read());
    const m = media();
    m.addEventListener("change", update);
    window.addEventListener("slideia-theme", update);
    return () => {
      m.removeEventListener("change", update);
      window.removeEventListener("slideia-theme", update);
    };
  }, []);
  return theme;
}
