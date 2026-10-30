/*
 * Autofit: shrinks the font of text elements that do not fit their slot, down to MIN_FIT.
 * Runs identically in the player, the editor and the headless preview (same fonts, same DOM).
 */

export const MIN_FIT = 0.7;
const STEP = 0.05;

/*
 * Tight line-heights let glyph ascenders/descenders exceed the line box by a few px, which
 * browsers report as scroll overflow; that slack (a fraction of the font size) is not overflow.
 */
function overflows(el: HTMLElement): boolean {
  const fontSize = Number.parseFloat(getComputedStyle(el).fontSize) || 16;
  const slack = Math.max(2, fontSize * 0.3);
  return el.scrollHeight - el.clientHeight > slack || el.scrollWidth - el.clientWidth > slack;
}

export interface FitResult {
  elementId: string;
  fit: number;
  overflowing: boolean;
}

/** Fits every `[data-fit]` element inside `root`. Elements must be laid out (not display:none). */
export function autofit(root: ParentNode): FitResult[] {
  const results: FitResult[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-fit]")) {
    el.style.removeProperty("--fit");
    el.classList.remove("is-overflowing");
    let fit = 1;
    while (overflows(el) && fit - STEP >= MIN_FIT - 1e-9) {
      fit = Math.round((fit - STEP) * 100) / 100;
      el.style.setProperty("--fit", String(fit));
    }
    const overflowing = overflows(el);
    if (overflowing) el.classList.add("is-overflowing");
    results.push({ elementId: el.dataset.elId ?? "", fit, overflowing });
  }
  return results;
}
