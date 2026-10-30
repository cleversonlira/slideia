/** Expands #abc to #aabbcc and lowercases. */
export function normalizeHex(hex: string): string {
  const h = hex.toLowerCase();
  if (h.length === 4) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
}

export function isHex(value: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex);
  return [
    Number.parseInt(h.slice(1, 3), 16),
    Number.parseInt(h.slice(3, 5), 16),
    Number.parseInt(h.slice(5, 7), 16),
  ];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `#${ca
    .map((v, i) => Math.round(v + ((cb[i] ?? 0) - v) * t))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}
