import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import type { ElementOf } from "@apresenta/core/browser";
import { api, resolveAsset } from "../api.js";
import { PLACEHOLDER_IMAGE } from "../defaults.js";
import { currentSlide, mutate, selectElement, toast, useEditor } from "../state.js";
import { Modal } from "../ui.js";

type Tab = "upload" | "url" | "crop";

/** Picks an image (upload, drag & drop, paste or URL) and crops/positions existing images. */
export function ImageDialog({ onClose }: { onClose: () => void }) {
  const target = useEditor((s) => s.imageTarget);
  const slide = useEditor((s) => currentSlide(s));
  const image =
    target?.kind === "element"
      ? (slide?.elements.find((e) => e.id === target.elementId && e.type === "image") as
          ElementOf<"image"> | undefined)
      : undefined;
  // The starter placeholder is a tiny gray image (also once stored as an asset).
  const [tiny, setTiny] = useState(false);
  const hasRealImage = !!image && image.asset !== PLACEHOLDER_IMAGE && !tiny;
  const [tab, setTab] = useState<Tab>(hasRealImage ? "crop" : "upload");
  useEffect(() => {
    if (!image) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth <= 32) {
        setTiny(true);
        setTab((t) => (t === "crop" ? "upload" : t));
      }
    };
    img.src = resolveAsset(image.asset);
  }, [image]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const apply = useCallback(
    (asset: string, alt?: string) => {
      if (!slide || !target) return;
      if (target.kind === "element")
        mutate([
          {
            op: "set_image",
            slide: slide.id,
            element: target.elementId,
            asset,
            ...(alt ? { alt } : {}),
          },
        ]);
      else if (target.kind === "background") {
        const bg =
          slide.background?.type === "image"
            ? slide.background
            : { type: "image" as const, overlay: 0.45 };
        mutate([{ op: "update_slide", slide: slide.id, patch: { background: { ...bg, asset } } }]);
      } else {
        const before = new Set(slide.elements.map((e) => e.id));
        if (
          mutate([
            {
              op: "add_element",
              slide: slide.id,
              element: {
                type: "image",
                asset,
                alt: alt ?? "",
                ...(target.slot ? { slot: target.slot } : {}),
              },
            },
          ])
        ) {
          const created = currentSlide()?.elements.find((e) => !before.has(e.id));
          if (created) selectElement(created.id);
        }
      }
      onClose();
    },
    [slide, target, onClose],
  );

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast("Escolha um arquivo de imagem.", "error");
    setBusy(true);
    try {
      const { asset } = await api.uploadImage(file);
      apply(asset, file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const fromUrl = async () => {
    setBusy(true);
    try {
      const { asset } = await api.imageFromUrl(url.trim());
      apply(asset);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Imagem" onClose={onClose} wide={tab === "crop"}>
      <div className="tabs small" role="tablist">
        <button
          type="button"
          role="tab"
          className={tab === "upload" ? "on" : ""}
          onClick={() => setTab("upload")}
        >
          Enviar arquivo
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "url" ? "on" : ""}
          onClick={() => setTab("url")}
        >
          Da internet
        </button>
        {hasRealImage && (
          <button
            type="button"
            role="tab"
            className={tab === "crop" ? "on" : ""}
            onClick={() => setTab("crop")}
          >
            Cortar e posicionar
          </button>
        )}
      </div>

      {tab === "upload" && (
        <label
          className={`dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) void upload(f);
          }}
          onPaste={(e) => {
            const f = [...e.clipboardData.files][0];
            if (f) void upload(f);
          }}
        >
          <input
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
          />
          <span>
            {busy ? "Enviando…" : "Arraste uma imagem aqui, cole (Ctrl+V) ou clique para escolher"}
          </span>
          <small>
            JPEG, PNG, WebP, GIF ou AVIF, até 10 MB. A imagem é otimizada automaticamente.
          </small>
        </label>
      )}

      {tab === "url" && (
        <div className="url-row">
          <input
            type="url"
            placeholder="https://…/imagem.jpg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void fromUrl()}
            aria-label="Endereço da imagem"
          />
          <button
            type="button"
            className="primary"
            disabled={busy || !/^https?:\/\//i.test(url.trim())}
            onClick={() => void fromUrl()}
          >
            {busy ? "Baixando…" : "Usar imagem"}
          </button>
        </div>
      )}

      {tab === "crop" && image && slide && (
        <CropTab image={image} slideId={slide.id} onDone={onClose} />
      )}
    </Modal>
  );
}

function CropTab({
  image,
  slideId,
  onDone,
}: {
  image: ElementOf<"image">;
  slideId: string;
  onDone: () => void;
}) {
  // Lock the crop to the frame's aspect on the slide, so the result is not distorted.
  const frame = document.querySelector<HTMLElement>(
    `.editor-stage [data-el-id="${CSS.escape(image.id)}"] .img-wrap`,
  );
  const aspect = frame ? frame.offsetWidth / Math.max(1, frame.offsetHeight) : 16 / 9;
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  const save = () => {
    if (!area) return;
    const rect = { x: area.x / 100, y: area.y / 100, w: area.width / 100, h: area.height / 100 };
    const full = rect.w > 0.995 && rect.h > 0.995;
    mutate([
      {
        op: "update_element",
        slide: slideId,
        element: image.id,
        patch: full
          ? {
              crop: null,
              focal: { x: Math.min(1, rect.x + rect.w / 2), y: Math.min(1, rect.y + rect.h / 2) },
            }
          : { crop: clampRect(rect), focal: null, fit: "cover" },
      },
    ]);
    onDone();
  };

  return (
    <div className="crop">
      <div className="crop-area">
        <Cropper
          image={resolveAsset(image.asset)}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          minZoom={1}
          maxZoom={5}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(a) => setArea(a)}
          objectFit="cover"
        />
      </div>
      <div className="row">
        <label className="inline-num">
          Zoom
          <input
            type="range"
            min={1}
            max={5}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            mutate([
              {
                op: "update_element",
                slide: slideId,
                element: image.id,
                patch: { crop: null, focal: null },
              },
            ]);
            onDone();
          }}
        >
          Remover corte
        </button>
        <button type="button" className="primary" onClick={save}>
          Aplicar
        </button>
      </div>
      <p className="hint">
        Arraste para posicionar e use o zoom para cortar. Sem zoom, apenas o ponto central é
        ajustado.
      </p>
    </div>
  );
}

function clampRect(r: { x: number; y: number; w: number; h: number }) {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const x = c(r.x);
  const y = c(r.y);
  return { x, y, w: Math.max(0.01, Math.min(1 - x, r.w)), h: Math.max(0.01, Math.min(1 - y, r.h)) };
}
