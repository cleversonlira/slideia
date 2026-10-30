const MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for HTML content and attribute values. */
export function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => MAP[c]!);
}

/** Only URLs that are safe as <img src>. */
export function safeImageSrc(src: string): string {
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(src)) return src;
  if (/^(?:https?:|blob:)/i.test(src)) return src;
  if (/^\/[^/]/.test(src) || /^\.\.?\//.test(src)) return src;
  return "";
}

/** Only URLs that are safe as <a href>. */
export function safeHref(href: string): string {
  return /^(?:https?:\/\/|mailto:)/i.test(href) ? href : "";
}
