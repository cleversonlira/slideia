# GEMINI.md

## Using the apresenta MCP server (presentations)

When the user asks for a presentation, follow the flow in `skills/apresentacoes/SKILL.md`:
briefing → outline for approval → `create_presentation` (whole deck, with speaker notes) →
`preview` → one batched `apply_edits` with fixes → give the editor and download links.
Before editing an existing presentation, call `get_presentation` or `get_changes` (the user may
have edited it by hand) and pass the latest version as `expectedVersion`.

## Working on this repository

Conventions and architecture are in `AGENTS.md` and `docs/ARQUITETURA.md`.
