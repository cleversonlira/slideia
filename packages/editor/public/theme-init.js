// Applies the saved light/dark preference before the first paint (no flash of the wrong theme).
// Kept in sync with src/theme.ts. External file because the CSP blocks inline scripts.
try {
  const t = localStorage.getItem("slideia-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  // Storage blocked (private mode): follow the system theme.
}
