import { memo, useLayoutEffect, useRef, useState } from "react";
import type { Presentation, Slide } from "@slideia/core/browser";
import { autofit } from "@slideia/renderer";
import { canvasSize, deckStyle, slideHtml, styleObject } from "../deck.js";

/**
 * A slide rendered by the renderer and scaled down to `width` px, or to the available width with
 * `"fill"` (the slide list: its width changes when the vertical scrollbar appears).
 */
export const Thumbnail = memo(function Thumbnail({
  slide,
  pres,
  width,
}: {
  slide: Slide;
  pres: Presentation;
  width: number | "fill";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState(0);
  const size = canvasSize(pres);
  const w = width === "fill" ? filled : width;
  const scale = w / size.width;

  useLayoutEffect(() => {
    if (width !== "fill" || !box.current) return;
    const el = box.current;
    setFilled(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => entry && setFilled(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = slideHtml(slide, pres);
    host.querySelectorAll("[data-step]").forEach((n) => n.classList.add("revealed"));
    void document.fonts.ready.then(() => host.isConnected && autofit(host));
  }, [slide, pres]);

  return (
    <div
      className="thumb"
      ref={box}
      style={
        width === "fill"
          ? { width: "100%", aspectRatio: `${size.width} / ${size.height}` }
          : { width, height: size.height * scale }
      }
    >
      <div
        className="deck thumb-stage"
        style={{
          ...styleObject(deckStyle(pres)),
          width: size.width,
          height: size.height,
          transform: `scale(${scale})`,
        }}
        ref={ref}
        aria-hidden="true"
      />
    </div>
  );
});
