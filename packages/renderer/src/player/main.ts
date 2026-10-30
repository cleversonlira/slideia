import type { Presentation } from "@slideia/core/browser";
import type { IconMap } from "../icons.js";
import { Player } from "./app.js";
import { bootPresenter } from "./presenter.js";

function readJson<T>(id: string, fallback: T): T {
  const el = document.getElementById(id);
  if (!el?.textContent) return fallback;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return fallback;
  }
}

function boot(): void {
  const root = document.getElementById("app");
  const pres = readJson<Presentation | null>("presentation", null);
  if (!root || !pres) {
    document.body.textContent = "Não foi possível ler a apresentação embutida neste arquivo.";
    return;
  }
  const icons = readJson<IconMap>("icons", {});
  if (location.hash === "#presenter") {
    bootPresenter(root, pres, icons);
    return;
  }
  const player = new Player(root, pres, icons);
  (window as unknown as { apresenta: Player }).apresenta = player;
  if (location.hash === "#print")
    void document.fonts.ready.then(() => setTimeout(() => window.print(), 300));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
