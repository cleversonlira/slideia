import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Limits {
  presentations: number;
  slides: number;
  /** Max bytes of an uploaded/downloaded image before processing. */
  imageBytes: number;
  /** Max image side after processing. */
  imageMaxSide: number;
  /** Max bytes of stored images per account. */
  storageBytes: number;
}

export interface Config {
  /** Folder visible to the user: rendered .html files go here. */
  home: string;
  /** Internal data (database, assets, token). */
  dataDir: string;
  /** Preferred port of the local editor. */
  port: number;
  host: "127.0.0.1";
  limits: Limits;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = resolve(env.APRESENTA_HOME ?? join(homedir(), "Apresentacoes"));
  return {
    home,
    dataDir: join(home, ".apresenta"),
    port: Number(env.APRESENTA_PORT ?? 47800),
    host: "127.0.0.1",
    limits: {
      presentations: Number(env.APRESENTA_LIMIT_PRESENTATIONS ?? 500),
      slides: Number(env.APRESENTA_LIMIT_SLIDES ?? 100),
      imageBytes: Number(env.APRESENTA_LIMIT_IMAGE_BYTES ?? 10 * 1024 * 1024),
      imageMaxSide: Number(env.APRESENTA_IMAGE_MAX_SIDE ?? 2560),
      storageBytes: Number(env.APRESENTA_LIMIT_STORAGE_BYTES ?? 500 * 1024 * 1024),
    },
  };
}
