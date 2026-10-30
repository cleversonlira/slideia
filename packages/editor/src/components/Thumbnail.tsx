import { memo, useLayoutEffect, useRef } from "react";
import type { Presentation, Slide } from "@apresenta/core/browser";
import { autofit } from "@apresenta/renderer";
import { canvasSize, deckStyle, slideHtml, styleObject } from "../deck.js";

/** A slide rendered by the renderer and scaled down to `width` px. */
export const Thumbnail = memo(function Thumbnail({
  slide,
  pres,
  width,
}: {
  slide: Slide;
  pres: Presentation;
  width: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = canvasSize(pres);
  const scale = width / size.width;
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = slideHtml(slide, pres);
    host.querySelectorAll("[data-step]").forEach((n) => n.classList.add("revealed"));
    void document.fonts.ready.then(() => host.isConnected && autofit(host));
  }, [slide, pres]);
  return (
    <div className="thumb" style={{ width, height: size.height * scale }}>
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
