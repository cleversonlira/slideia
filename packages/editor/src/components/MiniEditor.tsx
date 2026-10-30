import { EditorContent, useEditor as useTiptap } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { richTextEquals, type RichText } from "@apresenta/core/browser";
import { docToRichText, richTextToDoc } from "../tiptap/convert.js";
import { editorExtensions } from "../tiptap/extensions.js";

/**
 * Small rich text editor (notes, outline). Calls onCommit with the new value on blur and after a
 * pause in typing; external changes are applied when it is not focused.
 */
export function MiniEditor(props: {
  value: RichText | undefined;
  onCommit: (value: RichText) => void;
  placeholder?: string;
  lang?: string;
  className?: string;
  ariaLabel: string;
}) {
  const commitRef = useRef(props.onCommit);
  commitRef.current = props.onCommit;
  const valueRef = useRef(props.value);
  valueRef.current = props.value;
  const timer = useRef(0);

  const editor = useTiptap({
    extensions: editorExtensions(),
    content: richTextToDoc(props.value ?? { paragraphs: [] }),
    editorProps: {
      attributes: {
        class: `mini-editor rt ${props.className ?? ""}`,
        spellcheck: "true",
        lang: props.lang ?? "pt-BR",
        "aria-label": props.ariaLabel,
        "data-placeholder": props.placeholder ?? "",
      },
    },
    onUpdate: ({ editor: ed }) => {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush(ed.getJSON()), 1200);
    },
    onBlur: ({ editor: ed }) => {
      clearTimeout(timer.current);
      flush(ed.getJSON());
    },
  });

  function flush(json: Parameters<typeof docToRichText>[0]) {
    const rt = docToRichText(json);
    if (!richTextEquals(rt, valueRef.current)) commitRef.current(rt);
  }

  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = docToRichText(editor.getJSON());
    if (!richTextEquals(current, props.value)) {
      editor.commands.setContent(richTextToDoc(props.value ?? { paragraphs: [] }), {
        emitUpdate: false,
      });
    }
  }, [editor, props.value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <EditorContent
      editor={editor}
      className={`mini-editor-wrap ${editor?.isEmpty ? "empty" : ""}`}
    />
  );
}
