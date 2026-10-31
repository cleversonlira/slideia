import type { Brand, DesignWarning, Presentation } from "@slideia/core";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const headers: Record<string, string> = { "x-apresenta": "1" };
  let payload: BodyInit | undefined;
  if (raw) {
    headers["content-type"] = raw.type || "application/octet-stream";
    payload = raw;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload ?? null, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor local.");
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? `Erro ${res.status}`), json);
  return json as T;
}

export interface PresentationSummary {
  id: string;
  title: string;
  version: number;
  slides: number;
  theme: string;
  updatedAt: string;
  /** Has a public view-only link (remote mode). */
  shared?: boolean;
}

export interface VersionInfo {
  version: number;
  author: "user" | "ai";
  channel: string;
  summary: string[];
  createdAt: string;
}

export interface Account {
  email: string;
  name: string | null;
}

export interface Features {
  /** Public view-only links (remote mode only). */
  share: boolean;
}

export const api = {
  me: () => req<{ account: Account | null; features?: Features }>("GET", "/api/me"),
  share: (id: string) => req<{ url: string | null }>("GET", `/api/presentations/${id}/share`),
  enableShare: (id: string, fresh = false) =>
    req<{ url: string }>("POST", `/api/presentations/${id}/share`, { fresh }),
  disableShare: (id: string) => req<void>("DELETE", `/api/presentations/${id}/share`),
  list: () => req<{ presentations: PresentationSummary[] }>("GET", "/api/presentations"),
  get: (id: string) => req<{ presentation: Presentation }>("GET", `/api/presentations/${id}`),
  create: (title?: string) =>
    req<{ presentation: Presentation }>("POST", "/api/presentations", { title }),
  import: (data: unknown) =>
    req<{ presentation: Presentation }>("POST", "/api/presentations", { import: data }),
  remove: (id: string) => req<void>("DELETE", `/api/presentations/${id}`),
  duplicate: (id: string) =>
    req<{ presentation: Presentation }>("POST", `/api/presentations/${id}/duplicate`),
  ops: (id: string, expectedVersion: number, operations: unknown[]) =>
    req<{
      presentation: Presentation;
      changed: boolean;
      rebased: boolean;
      warnings: DesignWarning[];
      notes: string[];
    }>("POST", `/api/presentations/${id}/ops`, { expectedVersion, operations }),
  versions: (id: string) =>
    req<{ versions: VersionInfo[] }>("GET", `/api/presentations/${id}/versions`),
  version: (id: string, v: number) =>
    req<{ presentation: Presentation }>("GET", `/api/presentations/${id}/versions/${v}`),
  restore: (id: string, version: number) =>
    req<{ presentation: Presentation }>("POST", `/api/presentations/${id}/restore`, { version }),
  uploadImage: (file: Blob) =>
    req<{ asset: string; width: number; height: number }>("POST", "/api/assets", undefined, file),
  brand: () => req<{ brand: Brand | null }>("GET", "/api/brand"),
  saveBrand: (brand: Brand) => req<{ brand: Brand }>("PUT", "/api/brand", { brand }),
  forgetBrand: () => req<void>("DELETE", "/api/brand"),
  imageFromUrl: (url: string) =>
    req<{ asset: string; width: number; height: number }>("POST", "/api/assets", { url }),
};

export const exportUrls = {
  html: (id: string) => `/api/presentations/${id}/export.html`,
  download: (id: string) => `/api/presentations/${id}/export.html?download=1`,
  json: (id: string) => `/api/presentations/${id}/export.json`,
  pptx: (id: string) => `/api/presentations/${id}/export.pptx`,
};

/** Asset references are served by the local server. */
export function resolveAsset(ref: string): string {
  return ref.startsWith("asset:") ? `/media/${ref.slice(6)}` : ref;
}
