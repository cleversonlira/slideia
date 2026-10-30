---
name: apresentacoes
description: Create, edit and deliver HTML slide presentations with the "apresenta" MCP server (tools get_guide, create_presentation, apply_edits, preview, render). Use when the user asks for a presentation, deck, slides or a talk.
---

# Presentations with the apresenta MCP server

The `apresenta` MCP server stores presentations and renders them as a single offline `.html`
file with PowerPoint-style transitions and presenter-remote support. The user can also edit by
hand in a web editor; you and the editor change the same presentation.

## Ideal flow

1. **Briefing** — if goal, audience, duration or key data are missing, ask briefly (one message).
2. **Outline** — call `get_guide` once, then propose an outline: title + one line per slide
   (~1 slide per minute). Wait for approval unless the user asked you to go ahead.
3. **Create** — one `create_presentation` call with the whole deck. Vary layouts, use real numbers
   in `stats`/`chart`, write speaker notes on every slide, Markdown in text fields.
4. **Preview** — call `preview` (grid of all slides) and read the issues list. Fix everything in a
   **single** `apply_edits` call (batch all operations).
5. **Deliver** — give the editor link and the download link from the tool result. Mention keys:
   F5 to present, S for presenter view, T to test the remote.
6. **Later edits** — always call `get_presentation` (outline) or `get_changes` first: the user may
   have edited texts in the editor. Use the latest `version` as `expectedVersion`; never resend the
   whole deck for small changes.

## Rules of thumb

- One idea per slide; titles state the takeaway; ≤ 6 short bullets.
- Start with `cover`, open parts with `section`, end with `closing`.
- One default transition; special effects (zoom, cube3d, flip3d) on 1–2 key slides only.
- Images: public https URLs are downloaded by the server; if a download fails a placeholder is used
  and the result says so — then ask the user for an image or use `set_image` with another URL.
- On a conflict error, read the presentation again and redo only the affected edits.
