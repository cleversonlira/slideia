/*
 * Generates the illustrative images used by the example presentations (abstract art drawn with
 * CSS/SVG and captured by headless Chrome), so the repository needs no third-party photos.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const out = fileURLToPath(new URL("../../../assets/examples/assets/", import.meta.url));

const ART: Record<string, string> = {
  aurora: `<div style="position:absolute;inset:0;background:#0b1030"></div>
    <div style="position:absolute;width:1100px;height:1100px;left:-200px;top:-300px;border-radius:50%;background:radial-gradient(circle,#4f46e5 0,transparent 60%);filter:blur(40px)"></div>
    <div style="position:absolute;width:1200px;height:1200px;right:-300px;top:-100px;border-radius:50%;background:radial-gradient(circle,#06b6d4 0,transparent 60%);filter:blur(50px);opacity:.8"></div>
    <div style="position:absolute;width:900px;height:900px;left:500px;bottom:-500px;border-radius:50%;background:radial-gradient(circle,#c026d3 0,transparent 60%);filter:blur(50px);opacity:.75"></div>`,
  cidade: `<svg viewBox="0 0 1600 1000" width="1600" height="1000" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#60a5fa"/></linearGradient></defs>
    <rect width="1600" height="1000" fill="url(#sky)"/>
    <circle cx="1220" cy="260" r="120" fill="#fde68a" opacity=".9"/>
    ${Array.from({ length: 22 }, (_, i) => {
      const w = 60 + ((i * 37) % 70);
      const h = 260 + ((i * 113) % 480);
      const x = i * 74 - 20;
      const shade = ["#0f1c33", "#1b2a47", "#24375c", "#2c4370"][i % 4];
      const windows = Array.from({ length: Math.floor(h / 46) }, (_, r) =>
        Array.from({ length: Math.floor(w / 26) }, (_, c) =>
          (r * 7 + c * 3 + i) % 5 === 0
            ? `<rect x="${x + 10 + c * 24}" y="${1000 - h + 20 + r * 44}" width="12" height="20" fill="#fde68a" opacity=".85"/>`
            : "",
        ).join(""),
      ).join("");
      return `<rect x="${x}" y="${1000 - h}" width="${w}" height="${h}" fill="${shade}"/>${windows}`;
    }).join("")}
  </svg>`,
  montanhas: `<svg viewBox="0 0 1600 1000" width="1600" height="1000" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fb923c"/><stop offset=".55" stop-color="#f9a8d4"/><stop offset="1" stop-color="#c4b5fd"/></linearGradient></defs>
    <rect width="1600" height="1000" fill="url(#g)"/>
    <circle cx="800" cy="560" r="150" fill="#fff7ed" opacity=".9"/>
    <path d="M0 620 L220 430 L420 600 L640 380 L900 640 L1120 420 L1380 610 L1600 470 L1600 1000 L0 1000Z" fill="#7c3aed" opacity=".55"/>
    <path d="M0 720 L260 540 L520 720 L780 520 L1040 740 L1300 560 L1600 730 L1600 1000 L0 1000Z" fill="#5b21b6" opacity=".75"/>
    <path d="M0 820 L300 660 L600 830 L900 680 L1200 850 L1600 700 L1600 1000 L0 1000Z" fill="#3b0764"/>
  </svg>`,
};

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
for (const [name, body] of Object.entries(ART)) {
  await page.setContent(
    `<html><body style="margin:0;width:1600px;height:1000px;position:relative;overflow:hidden">${body}</body></html>`,
  );
  await page.screenshot({ path: `${out}${name}.jpg`, type: "jpeg", quality: 82 });
  console.log(`${name}.jpg`);
}
await browser.close();
