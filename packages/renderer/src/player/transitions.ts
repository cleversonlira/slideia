import type { Transition } from "@slideia/core/browser";

type Dir = "left" | "right" | "up" | "down";

const EASE = "cubic-bezier(.65,0,.35,1)";
const PERSPECTIVE = "perspective(2400px)";

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function flip(d: Dir): Dir {
  return d === "left" ? "right" : d === "right" ? "left" : d === "up" ? "down" : "up";
}

/** Offset (in %) where an entering slide starts for a movement in direction `d`. */
function startOffset(d: Dir): [number, number] {
  switch (d) {
    case "left":
      return [100, 0];
    case "right":
      return [-100, 0];
    case "up":
      return [0, 100];
    case "down":
      return [0, -100];
  }
}

function tr(x: number, y: number): string {
  return `translate(${x}%, ${y}%)`;
}

interface Plan {
  from?: Keyframe[];
  to?: Keyframe[];
  fromOrigin?: string;
  toOrigin?: string;
  /** Leaving slide drawn above the entering one. */
  fromOnTop?: boolean;
}

function plan(type: Transition["type"], d: Dir): Plan {
  const [sx, sy] = startOffset(d);
  const horizontal = d === "left" || d === "right";
  const sign = d === "left" || d === "up" ? 1 : -1;
  switch (type) {
    case "fade":
      return { to: [{ opacity: 0 }, { opacity: 1 }] };
    case "dissolve":
      return {
        from: [{ opacity: 1 }, { opacity: 0 }],
        to: [
          { opacity: 0, transform: "scale(1.035)" },
          { opacity: 1, transform: "scale(1)" },
        ],
      };
    case "slide":
      return { to: [{ transform: tr(sx, sy) }, { transform: tr(0, 0) }] };
    case "push":
      return {
        from: [{ transform: tr(0, 0) }, { transform: tr(-sx, -sy) }],
        to: [{ transform: tr(sx, sy) }, { transform: tr(0, 0) }],
      };
    case "reveal":
      return { fromOnTop: true, from: [{ transform: tr(0, 0) }, { transform: tr(-sx, -sy) }] };
    case "zoom":
      return {
        from: [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(1.08)" },
        ],
        to: [
          { opacity: 0, transform: "scale(.6)" },
          { opacity: 1, transform: "scale(1)" },
        ],
      };
    case "flip3d": {
      const rot = horizontal ? "rotateY" : "rotateX";
      const s = horizontal ? -sign : sign;
      return {
        from: [
          { transform: `${PERSPECTIVE} ${rot}(0deg)` },
          { transform: `${PERSPECTIVE} ${rot}(${180 * s}deg)` },
        ],
        to: [
          { transform: `${PERSPECTIVE} ${rot}(${-180 * s}deg)` },
          { transform: `${PERSPECTIVE} ${rot}(0deg)` },
        ],
      };
    }
    case "cube3d": {
      if (horizontal) {
        const a = sign * 90;
        return {
          fromOrigin: sign > 0 ? "100% 50%" : "0% 50%",
          toOrigin: sign > 0 ? "0% 50%" : "100% 50%",
          from: [
            { transform: `${PERSPECTIVE} translateX(0%) rotateY(0deg)` },
            { transform: `${PERSPECTIVE} translateX(${-sx}%) rotateY(${-a}deg)` },
          ],
          to: [
            { transform: `${PERSPECTIVE} translateX(${sx}%) rotateY(${a}deg)` },
            { transform: `${PERSPECTIVE} translateX(0%) rotateY(0deg)` },
          ],
        };
      }
      const a = sign * 90;
      return {
        fromOrigin: sign > 0 ? "50% 100%" : "50% 0%",
        toOrigin: sign > 0 ? "50% 0%" : "50% 100%",
        from: [
          { transform: `${PERSPECTIVE} translateY(0%) rotateX(0deg)` },
          { transform: `${PERSPECTIVE} translateY(${-sy}%) rotateX(${a}deg)` },
        ],
        to: [
          { transform: `${PERSPECTIVE} translateY(${sy}%) rotateX(${-a}deg)` },
          { transform: `${PERSPECTIVE} translateY(0%) rotateX(0deg)` },
        ],
      };
    }
    default:
      return {};
  }
}

/**
 * Animates `from` → `to` (both absolutely positioned in the same stage). Resolves when done.
 * `backwards` replays the transition with the direction flipped.
 */
export async function runTransition(
  from: HTMLElement | null,
  to: HTMLElement,
  t: Transition,
  backwards: boolean,
): Promise<void> {
  const reduced = prefersReducedMotion();
  const type = reduced && t.type !== "none" ? "fade" : t.type;
  const duration = reduced
    ? 200
    : (t.durationMs ?? (type === "cube3d" || type === "flip3d" ? 900 : 600));
  let dir: Dir = t.direction ?? "left";
  if (backwards) dir = flip(dir);

  if (!from || type === "none") return;
  const p = plan(type, dir);
  from.style.zIndex = p.fromOnTop ? "3" : "1";
  to.style.zIndex = p.fromOnTop ? "1" : "2";
  if (p.fromOrigin) from.style.transformOrigin = p.fromOrigin;
  if (p.toOrigin) to.style.transformOrigin = p.toOrigin;
  const opts: KeyframeAnimationOptions = { duration, easing: EASE, fill: "both" };
  const anims: Animation[] = [];
  if (p.from) anims.push(from.animate(p.from, opts));
  if (p.to) anims.push(to.animate(p.to, opts));
  try {
    await Promise.all(anims.map((a) => a.finished));
  } catch {
    // cancelled: fall through to cleanup
  }
  for (const a of anims) a.cancel();
  from.style.zIndex = "";
  to.style.zIndex = "";
  from.style.transformOrigin = "";
  to.style.transformOrigin = "";
}

const STEP_FRAMES: Record<string, Keyframe[]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  rise: [
    { opacity: 0, transform: "translateY(36px)" },
    { opacity: 1, transform: "translateY(0)" },
  ],
  zoom: [
    { opacity: 0, transform: "scale(.85)" },
    { opacity: 1, transform: "scale(1)" },
  ],
  wipe: [
    { opacity: 1, clipPath: "inset(0 100% 0 0)" },
    { opacity: 1, clipPath: "inset(0 0% 0 0)" },
  ],
};

/** Entrance animation of a step node. */
export function revealNode(node: HTMLElement, animate: boolean): void {
  node.classList.add("revealed");
  if (!animate) return;
  const frames = prefersReducedMotion()
    ? STEP_FRAMES.fade!
    : (STEP_FRAMES[node.dataset.anim ?? "fade"] ?? STEP_FRAMES.fade!);
  node.animate(frames, {
    duration: prefersReducedMotion() ? 150 : 480,
    easing: "cubic-bezier(.2,.7,.2,1)",
  });
}
