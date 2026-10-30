import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import sharp, { type Metadata } from "sharp";

export class ImageError extends Error {}

export interface ProcessedImage {
  data: Uint8Array;
  mime: "image/jpeg" | "image/webp";
  width: number;
  height: number;
}

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"]);

/**
 * Validates and normalizes an image: decodes it (rejecting non-images and SVG), applies EXIF
 * rotation, strips metadata, limits the size and re-encodes (JPEG, or WebP when transparent).
 */
export async function processImage(input: Uint8Array, maxSide: number): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 80_000_000 }).metadata();
  } catch {
    throw new ImageError("The file is not a supported image (use JPEG, PNG, WebP, GIF or AVIF).");
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new ImageError(
      `Image format "${meta.format ?? "unknown"}" is not supported (use JPEG, PNG, WebP, GIF or AVIF).`,
    );
  }
  const pipeline = sharp(input, { limitInputPixels: 80_000_000, pages: 1 })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  const transparent = meta.hasAlpha === true;
  const { data, info } = transparent
    ? await pipeline.webp({ quality: 86 }).toBuffer({ resolveWithObject: true })
    : await pipeline
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
  return {
    data,
    mime: transparent ? "image/webp" : "image/jpeg",
    width: info.width,
    height: info.height,
  };
}

/** A neutral placeholder used when an image URL cannot be downloaded. */
export async function placeholderImage(): Promise<ProcessedImage> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e5e7eb"/><stop offset="1" stop-color="#cbd5e1"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><g fill="none" stroke="#94a3b8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" transform="translate(680 330) scale(10)"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></g></svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .jpeg({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { data, mime: "image/jpeg", width: info.width, height: info.height };
}

export function decodeDataUri(uri: string, maxBytes: number): Uint8Array {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(uri);
  if (!m) throw new ImageError("Invalid data URI: expected data:image/<type>;base64,<data>.");
  const data = Buffer.from(m[1]!.replace(/\s+/g, ""), "base64");
  if (data.byteLength > maxBytes)
    throw new ImageError(`Image is larger than ${Math.round(maxBytes / 1048576)} MB.`);
  return data;
}

// ---------------------------------------------------------------------------
// SSRF-safe download
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** True for loopback, private, link-local, CGNAT, multicast, documentation and metadata ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return (
    /^(?:fc|fd|fe8|fe9|fea|feb|ff)/.test(v6) ||
    v6.startsWith("64:ff9b:") ||
    v6.startsWith("2001:db8:")
  );
}

async function resolvePublic(hostname: string): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new ImageError(`Could not resolve ${hostname}.`);
  for (const a of addrs) {
    if (isPrivateAddress(a.address))
      throw new ImageError(`Refusing to download from a private or local address (${hostname}).`);
  }
  return addrs[0]!;
}

export interface FetchOptions {
  maxBytes: number;
  accept: string;
  redirects?: number;
  timeoutMs?: number;
  /** Development only: allow private/loopback hosts. */
  allowPrivate?: boolean;
}

/**
 * Downloads from a public http(s) URL. The resolved IP is validated and pinned for the
 * connection (no DNS rebinding), redirects are re-validated, and size/time are limited.
 */
export async function fetchPublic(
  url: string,
  opts: FetchOptions,
): Promise<{ data: Uint8Array; contentType: string }> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new ImageError(`Invalid URL: ${url}`);
  }
  if (target.protocol !== "https:" && target.protocol !== "http:")
    throw new ImageError("Only http(s) URLs are allowed.");
  if (!opts.allowPrivate && target.port && target.port !== "80" && target.port !== "443") {
    throw new ImageError("Only ports 80 and 443 are allowed.");
  }
  if (target.username || target.password)
    throw new ImageError("URLs with credentials are not allowed.");
  const { address, family } = opts.allowPrivate
    ? await lookup(target.hostname.replace(/^\[|\]$/g, ""))
    : await resolvePublic(target.hostname);
  const client = target.protocol === "https:" ? https : http;
  const maxBytes = opts.maxBytes;
  const redirects = opts.redirects ?? 3;

  return new Promise((resolve, reject) => {
    const req = client.get(
      target,
      {
        lookup: (_host, _o, cb) => cb(null, address, family),
        headers: { "user-agent": "Apresenta/0.1", accept: opts.accept },
        timeout: opts.timeoutMs ?? 10_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) return reject(new ImageError("Too many redirects."));
          const next = new URL(res.headers.location, target).toString();
          return resolve(fetchPublic(next, { ...opts, redirects: redirects - 1 }));
        }
        if (status !== 200) {
          res.resume();
          return reject(new ImageError(`The server answered HTTP ${status} for ${url}.`));
        }
        const tooBig = () =>
          new ImageError(`File is larger than ${Math.round(maxBytes / 1024)} KB.`);
        if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
          res.destroy();
          return reject(tooBig());
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.byteLength;
          if (total > maxBytes) {
            res.destroy();
            reject(tooBig());
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            data: Buffer.concat(chunks),
            contentType: String(res.headers["content-type"] ?? ""),
          }),
        );
        res.on("error", (e) => reject(new ImageError(`Download failed: ${e.message}`)));
      },
    );
    req.on("timeout", () => req.destroy(new ImageError("Download timed out.")));
    req.on("error", (e) =>
      reject(e instanceof ImageError ? e : new ImageError(`Download failed: ${e.message}`)),
    );
  });
}

/** Downloads an image from a public http(s) URL (see fetchPublic). */
export async function fetchImage(url: string, maxBytes: number): Promise<Uint8Array> {
  return (await fetchPublic(url, { maxBytes, accept: "image/*" })).data;
}
