import type { Presentation } from "@apresenta/core/browser";
import { autofit } from "../fit.js";
import type { IconMap } from "../icons.js";
import { canvasSize, computeSteps, createContext, renderSlide } from "../render.js";
import { richTextToHtml } from "../richtext-html.js";
import { uiIcon } from "./icons.js";
import { Keymap } from "./keys.js";
import { Channel, type Blank, type Message } from "./protocol.js";

/** Presenter view: runs in a second window opened by the main player (URL hash #presenter). */
export function bootPresenter(root: HTMLElement, pres: Presentation, icons: IconMap): void {
  const ctx = createContext(pres, { icons });
  const visible = pres.slides.filter((s) => !s.hidden);
  const { width, height } = canvasSize(pres.meta.aspectRatio);
  const keymap = new Keymap();
  let state = { index: 0, step: 0, blank: null as Blank, total: visible.length };
  let connected = false;

  document.title = `Apresentador · ${pres.meta.title}`;
  document.body.classList.add("presenter-mode");
  root.className = "pv";
  root.innerHTML = `
    <header class="pv-top">
      <div class="pv-timer"><span class="pv-time">00:00</span>
        <button data-t="pause" title="Pausar/continuar">${uiIcon("pause")}</button>
        <button data-t="reset" title="Zerar">${uiIcon("reset")}</button></div>
      <div class="pv-count"></div>
      <div class="pv-clock"></div>
    </header>
    <main class="pv-main">
      <section class="pv-current"><div class="pv-label">Agora <span class="pv-blank"></span></div><div class="pv-box deck" data-box="current"></div></section>
      <aside class="pv-side">
        <section class="pv-next"><div class="pv-label pv-next-label">Próximo</div><div class="pv-box deck" data-box="next"></div></section>
        <section class="pv-notes"><div class="pv-label">Anotações
          <span class="pv-zoom"><button data-z="-1" title="Diminuir texto">${uiIcon("minus")}</button><button data-z="1" title="Aumentar texto">${uiIcon("plus")}</button></span></div>
          <div class="pv-notes-body deck"></div></section>
      </aside>
    </main>
    <footer class="pv-controls">
      <button data-c="prev">${uiIcon("prev")} Voltar</button>
      <button data-c="black">${uiIcon("square")} Tela preta</button>
      <button data-c="next">Avançar ${uiIcon("next")}</button>
      <span class="pv-status"></span>
    </footer>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const boxCurrent = $('[data-box="current"]');
  const boxNext = $('[data-box="next"]');
  const notes = $(".pv-notes-body");
  const status = $(".pv-status");

  // Notes font size
  let zoom = 1;
  try {
    zoom = Number(localStorage.getItem("apresenta.notesZoom")) || 1;
  } catch {
    zoom = 1;
  }
  const applyZoom = () => notes.style.setProperty("--zoom", String(zoom));
  applyZoom();
  root.querySelector(".pv-zoom")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-z]");
    if (!b) return;
    zoom = Math.min(2.5, Math.max(0.6, zoom + Number(b.dataset.z) * 0.15));
    applyZoom();
    try {
      localStorage.setItem("apresenta.notesZoom", String(zoom));
    } catch {
      // ignore
    }
  });

  // Timer and clock
  let elapsed = 0;
  let running = true;
  let last = performance.now();
  const fmt = (ms: number) => {
    const t = Math.floor(ms / 1000);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };
  const tick = () => {
    const now = performance.now();
    if (running) elapsed += now - last;
    last = now;
    $(".pv-time").textContent = fmt(elapsed);
    $(".pv-clock").textContent = new Date().toLocaleTimeString(pres.meta.lang, {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (window.opener && (window.opener as Window).closed)
      status.textContent = "Janela principal fechada";
  };
  setInterval(tick, 500);
  tick();
  root.querySelector(".pv-timer")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-t]");
    if (!b) return;
    if (b.dataset.t === "pause") {
      running = !running;
      b.innerHTML = uiIcon(running ? "pause" : "play");
    } else {
      elapsed = 0;
    }
    tick();
  });

  const channel = new Channel(`apresenta-${pres.id}`, (m: Message) => {
    if (m.type !== "state") return;
    connected = true;
    status.textContent = "";
    state = { index: m.index, step: m.step, blank: m.blank, total: m.total };
    render();
  });
  if (window.opener) channel.peer = window.opener as Window;

  const send = (action: Message & { type: "cmd" }) => channel.send(action);
  const cmd = (action: "next" | "prev" | "black" | "white" | "first" | "last") =>
    send({ __apz: 1, type: "cmd", action });

  root.querySelector(".pv-controls")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-c]");
    if (b) cmd(b.dataset.c as "next" | "prev" | "black");
  });

  let gotoBuf = "";
  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (/^[0-9]$/.test(e.key)) {
      gotoBuf = (gotoBuf + e.key).slice(-4);
      status.textContent = `Ir para o slide ${gotoBuf}`;
      return;
    }
    if (gotoBuf && e.key === "Enter") {
      e.preventDefault();
      send({ __apz: 1, type: "cmd", action: "goto", index: Number(gotoBuf) - 1 });
      gotoBuf = "";
      status.textContent = "";
      return;
    }
    const a = keymap.resolve(e);
    if (!a) return;
    e.preventDefault();
    if (
      a === "next" ||
      a === "prev" ||
      a === "black" ||
      a === "white" ||
      a === "first" ||
      a === "last"
    )
      cmd(a);
    if (a === "escape") {
      gotoBuf = "";
      status.textContent = "";
    }
  });

  const mount = (box: HTMLElement, html: string, revealUpTo: number) => {
    box.innerHTML = html
      ? `<div class="pv-scale" style="width:${width}px;height:${height}px">${html}</div>`
      : `<div class="pv-end">Fim da apresentação</div>`;
    const slide = box.querySelector<HTMLElement>(".slide");
    if (slide) {
      for (const n of slide.querySelectorAll<HTMLElement>("[data-step]")) {
        if (Number(n.dataset.step) <= revealUpTo) n.classList.add("revealed");
      }
      autofit(slide);
    }
    scaleBox(box);
  };
  const scaleBox = (box: HTMLElement) => {
    const inner = box.querySelector<HTMLElement>(".pv-scale");
    if (inner) inner.style.transform = `scale(${box.clientWidth / width})`;
  };
  const ro = new ResizeObserver(() => {
    scaleBox(boxCurrent);
    scaleBox(boxNext);
  });
  ro.observe(boxCurrent);
  ro.observe(boxNext);
  for (const b of [boxCurrent, boxNext]) b.style.aspectRatio = `${width} / ${height}`;

  function render(): void {
    const cur = visible[state.index];
    if (!cur) return;
    const curSteps = computeSteps(cur).count;
    mount(boxCurrent, renderSlide(cur, ctx), state.step);
    const nextLabel = $(".pv-next-label");
    if (state.step < curSteps) {
      mount(boxNext, renderSlide(cur, ctx), state.step + 1);
      nextLabel.textContent = "Próximo passo";
    } else if (visible[state.index + 1]) {
      mount(boxNext, renderSlide(visible[state.index + 1]!, ctx), 99);
      nextLabel.textContent = "Próximo slide";
    } else {
      mount(boxNext, "", 0);
      nextLabel.textContent = "Próximo";
    }
    notes.innerHTML = cur.notes
      ? richTextToHtml(cur.notes, { className: "pv-notes-text" })
      : `<p class="muted">Sem anotações neste slide.</p>`;
    $(".pv-count").textContent =
      `Slide ${state.index + 1} de ${state.total}${curSteps ? ` · passo ${state.step}/${curSteps}` : ""}`;
    $(".pv-blank").textContent =
      state.blank === "black" ? "· tela preta" : state.blank === "white" ? "· tela branca" : "";
  }

  render();
  void document.fonts?.ready.then(render);
  channel.send({ __apz: 1, type: "hello" });
  setTimeout(() => {
    if (!connected)
      status.textContent =
        "Aguardando a janela principal… (abra pelo botão do apresentador ou tecla S)";
  }, 1500);
}
