import type { Presentation } from "@apresenta/core/browser";

/** Icon name (kebab-case) → inner SVG markup (24×24 Lucide grid). */
export type IconMap = Record<string, string>;

export const TREND_ICONS = { up: "trending-up", down: "trending-down" } as const;

export function iconSvg(name: string, icons: IconMap, className = "icon"): string {
  const inner = icons[name];
  const body = inner ?? '<rect x="3" y="3" width="18" height="18" rx="4" stroke-dasharray="3 3"/>';
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** All icon names a presentation needs (for embedding only those in the export). */
export function collectIconNames(p: Presentation): string[] {
  const names = new Set<string>();
  for (const s of p.slides) {
    for (const e of s.elements) {
      if (e.type === "icon") names.add(e.name);
      if (e.type === "stat") {
        if (e.icon) names.add(e.icon);
        if (e.trend) names.add(TREND_ICONS[e.trend]);
      }
    }
  }
  return [...names].sort();
}
