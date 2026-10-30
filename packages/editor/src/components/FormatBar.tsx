import type { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Presentation } from "@apresenta/core/browser";
import { ColorPicker, Icon, IconButton } from "../ui.js";

type Pop = null | "color" | "highlight" | "link" | "size" | "align";

const SIZES = [
  { value: "small", label: "Pequeno" },
  { value: null, label: "Normal" },
  { value: "large", label: "Grande" },
  { value: "display", label: "Destaque" },
] as const;

const ALIGNS = [
  { value: "left", icon: "align-left", label: "Esquerda" },
  { value: "center", icon: "align-center", label: "Centro" },
  { value: "right", icon: "align-right", label: "Direita" },
  { value: "justify", icon: "align-justify", label: "Justificado" },
] as const;

/** Floating formatting toolbar for the text being edited on the slide. */
export function FormatBar({
  editor,
  anchor,
  pres,
  tick,
}: {
  editor: Editor;
  anchor: HTMLElement;
  pres: Presentation;
  tick: number;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [pop, setPop] = useState<Pop>(null);
  const [link, setLink] = useState("");
  const barRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const barH = barRef.current?.offsetHeight ?? 44;
      const barW = barRef.current?.offsetWidth ?? 600;
      const top = r.top - barH - 10 > 8 ? r.top - barH - 10 : r.bottom + 10;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - barW - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, tick]);

  // Ctrl+K opens the link editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && editor.isFocused) {
        e.preventDefault();
        setLink((editor.getAttributes("link").href as string | undefined) ?? "https://");
        setPop("link");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  const chain = () => editor.chain().focus();
  const is = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);
  const toggle = (p: Pop) => setPop((cur) => (cur === p ? null : p));
  const para = editor.getAttributes("paragraph") as { align?: string | null; size?: string | null };
  const inList = is("bulletList") || is("orderedList");

  const applyLink = () => {
    const href = link.trim();
    if (!href || href === "https://") chain().extendMarkRange("link").unsetLink().run();
    else if (/^(?:https?:\/\/|mailto:)/i.test(href))
      chain().extendMarkRange("link").setLink({ href }).run();
    else
      chain()
        .extendMarkRange("link")
        .setLink({ href: `https://${href}` })
        .run();
    setPop(null);
  };

  return (
    <div
      className="format-bar"
      ref={barRef}
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}
    >
      <IconButton
        keepFocus
        icon="bold"
        label="Negrito (Ctrl+B)"
        active={is("bold")}
        onClick={() => chain().toggleBold().run()}
      />
      <IconButton
        keepFocus
        icon="italic"
        label="Itálico (Ctrl+I)"
        active={is("italic")}
        onClick={() => chain().toggleItalic().run()}
      />
      <IconButton
        keepFocus
        icon="underline"
        label="Sublinhado (Ctrl+U)"
        active={is("underline")}
        onClick={() => chain().toggleUnderline().run()}
      />
      <IconButton
        keepFocus
        icon="strikethrough"
        label="Tachado"
        active={is("strike")}
        onClick={() => chain().toggleStrike().run()}
      />
      <span className="sep" />
      <div className="pop-wrap">
        <IconButton
          keepFocus
          icon="baseline"
          label="Cor do texto"
          active={is("textColor")}
          onClick={() => toggle("color")}
        />
        {pop === "color" && (
          <div className="popover">
            <ColorPicker
              keepFocus
              allowNone
              pres={pres}
              value={editor.getAttributes("textColor").color as string | undefined}
              tokens={["text", "muted", "accent", "accent2", "success", "danger"]}
              onChange={(c) => {
                if (c) chain().setTextColor(c).run();
                else chain().unsetTextColor().run();
                setPop(null);
              }}
            />
          </div>
        )}
      </div>
      <div className="pop-wrap">
        <IconButton
          keepFocus
          icon="highlighter"
          label="Destaque (marca-texto)"
          active={is("hl")}
          onClick={() => toggle("highlight")}
        />
        {pop === "highlight" && (
          <div className="popover">
            <ColorPicker
              keepFocus
              allowNone
              pres={pres}
              value={editor.getAttributes("hl").color as string | undefined}
              tokens={["highlight", "accent", "accent2", "surface"]}
              onChange={(c) => {
                if (c) chain().setHl(c).run();
                else chain().unsetHl().run();
                setPop(null);
              }}
            />
          </div>
        )}
      </div>
      <div className="pop-wrap">
        <IconButton
          keepFocus
          icon="link"
          label="Link (Ctrl+K)"
          active={is("link")}
          onClick={() => {
            setLink((editor.getAttributes("link").href as string | undefined) ?? "https://");
            toggle("link");
          }}
        />
        {pop === "link" && (
          <div className="popover link-pop">
            <input
              autoFocus
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyLink();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setPop(null);
                  editor.commands.focus();
                }
              }}
              aria-label="Endereço do link"
            />
            <button type="button" onClick={applyLink}>
              OK
            </button>
            {is("link") && (
              <button
                type="button"
                onClick={() => {
                  chain().extendMarkRange("link").unsetLink().run();
                  setPop(null);
                }}
              >
                Remover
              </button>
            )}
          </div>
        )}
      </div>
      <span className="sep" />
      <div className="pop-wrap">
        <IconButton
          keepFocus
          icon={ALIGNS.find((a) => a.value === para.align)?.icon ?? "align-left"}
          label="Alinhamento"
          onClick={() => toggle("align")}
        />
        {pop === "align" && (
          <div className="popover row">
            {ALIGNS.map((a) => (
              <IconButton
                keepFocus
                key={a.value}
                icon={a.icon}
                label={a.label}
                active={para.align === a.value}
                onClick={() => {
                  chain()
                    .setAlign(para.align === a.value ? null : a.value)
                    .run();
                  setPop(null);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <IconButton
        keepFocus
        icon="list"
        label="Lista com marcadores"
        active={is("bulletList")}
        onClick={() => chain().toggleBulletList().run()}
      />
      <IconButton
        keepFocus
        icon="list-ordered"
        label="Lista numerada"
        active={is("orderedList")}
        onClick={() => chain().toggleOrderedList().run()}
      />
      <IconButton
        keepFocus
        icon="indent-increase"
        label="Aumentar recuo (Tab)"
        disabled={!inList}
        onClick={() => chain().sinkListItem("listItem").run()}
      />
      <IconButton
        keepFocus
        icon="indent-decrease"
        label="Diminuir recuo (Shift+Tab)"
        disabled={!inList}
        onClick={() => chain().liftListItem("listItem").run()}
      />
      <span className="sep" />
      <div className="pop-wrap">
        <button
          type="button"
          className="text-btn"
          title="Tamanho"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggle("size")}
        >
          <Icon name="a-large-small" /> {SIZES.find((s) => s.value === (para.size ?? null))?.label}
        </button>
        {pop === "size" && (
          <div className="popover column">
            {SIZES.map((s) => (
              <button
                type="button"
                key={s.label}
                className={(para.size ?? null) === s.value ? "on" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  chain().setSize(s.value).run();
                  setPop(null);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <IconButton
        keepFocus
        icon="superscript"
        label="Sobrescrito"
        active={is("superscript")}
        onClick={() => chain().toggleSuperscript().run()}
      />
      <IconButton
        keepFocus
        icon="subscript"
        label="Subscrito"
        active={is("subscript")}
        onClick={() => chain().toggleSubscript().run()}
      />
      <IconButton
        keepFocus
        icon="remove-formatting"
        label="Limpar formatação"
        onClick={() => chain().unsetAllMarks().setAlign(null).setSize(null).run()}
      />
    </div>
  );
}
