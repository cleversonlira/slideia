# AGENTS.md — convenções do projeto

Ferramenta de criação, edição e apresentação de slides em HTML, operada por IA via MCP
(**SlideIA**, https://slideia.site; escopo npm `@slideia/*`). Arquitetura completa e
decisões: `docs/ARQUITETURA.md`. Especificação original: `prompt-ferramenta-apresentacoes.md`.

## Estado

- Fase 1 (core + renderer + player): **concluída**.
- Fase 2 (servidor MCP local stdio + editor visual): **concluída**.
- Fase 3 (servidor remoto: MCP HTTP + OAuth 2.1 + contas + Postgres/S3), simulado localmente: **concluída**
  (detalhes em `docs/REMOTO.md`).
- Fase 4: páginas públicas, **widget no chat (MCP Apps)** e marca da empresa no tema feitos;
  material de submissão em `docs/SUBMISSAO.md` (falta enviar); `.mcpb` para o Claude Desktop
  (`pnpm mcpb`); exportação para PowerPoint editável (`server/src/pptx.ts`).
- Produção: **https://slideia.site** (MCP em `/mcp`) numa VPS própria, via `deploy/vps/` (Docker
  Compose + Postgres atrás do nginx do host, TLS pelo certbot, backup diário). E-mail por SMTP da
  Hostinger (`suporte@slideia.site`, `deploy/vps/set-smtp.sh`). Alertas por e-mail via
  `deploy/vps/watchdog.sh`; `restore-test.sh` prova que o backup restaura.

## Pacotes

- `packages/core` — Presentation Schema (Zod), Markdown estendido ⇄ texto rico, layouts/slots,
  temas, normalização da entrada da IA, operações (`applyOps`), `diffToOps`, regras de design.
  - `@slideia/core` exporta tudo; `@slideia/core/browser` é a entrada **sem Zod** para bundles
    de navegador (player, canvas do editor). Constantes ficam em `constants.ts` (sem Zod) por isso.
- `packages/renderer` — `Presentation → HTML` (funções puras, sem framework), CSS de temas e
  layouts, autofit, parser DOM → texto rico, player standalone (`src/player`), export autocontido
  e CLI (`src/node`, só Node). `src/widget` é a view MCP Apps do chat (carrossel; bundle
  `dist/widget.js`, HTML montado por `buildWidgetHtml` em `src/node/widget.ts`).
- `packages/server` — serviço (`service.ts`: criar, `apply` com rebase/conflito, histórico,
  imagens, `get_changes`), armazenamento SQLite (`node:sqlite`, WAL, vários processos), MCP
  (`mcp.ts`, 10 tools + prompts + resources; SDK `@modelcontextprotocol/server` v2, protocolo
  2026-07-28 e 2025-era), API HTTP do editor (`http.ts`: token → cookie,
  CSRF por cabeçalho `x-apresenta`, proteção de Host, SSE), preview e exportação .pptx com Chrome
  headless (`playwright-core`; `pptx.ts`, `pptx-scan.ts`), download de imagens com proteção SSRF (`images.ts`). Entrada: `stdio.ts`;
  `scripts/build.ts` gera `dist/stdio.js` com editor, player, fontes e exemplos ao lado.
- `packages/server/src/remote` — modo remoto: `app.ts` (rotas), `oauth.ts` (servidor OAuth 2.1),
  `accounts.ts` (contas, sessões, LGPD), `pg-repo.ts`/`sql.ts` (Postgres/PGlite + migrações),
  `pages.ts` (telas de login/consentimento), `main.ts` (`startRemote`, entrada `dist/remote.js`).
- `packages/editor` — React + Vite + TipTap. Renderiza os slides com o mesmo renderer do player;
  edição no lugar monta o TipTap dentro do `.rt[data-field]` do slide. Toda alteração vira
  operação local (`applyOps`), com desfazer/refazer; o autosave envia `diffToOps` com
  `expectedVersion`; mudanças da IA chegam por SSE e as edições locais são rebaseadas.

Pacotes internos são consumidos pelo código-fonte (`exports` aponta para `src/*.ts`); não há
etapa de build entre eles. Artefatos gerados: `packages/renderer/dist/player.js`,
`packages/editor/dist/` e `packages/server/dist/`.

## Decisões que não devem ser revertidas sem discussão

- Slides usam **layouts com slots**, nunca coordenadas x/y.
- Texto rico é **estruturado** (parágrafos → runs com marcas). Nunca armazenar nem renderizar HTML
  vindo de conteúdo. Todo texto passa por `esc()`; URLs por `safeHref`/`safeImageSrc`.
- `richTextToMarkdown` é canônico e **sem perdas**: `markdownToRichText(richTextToMarkdown(x))`
  deve igualar `normalizeRichText(x)` (teste de propriedade em `core/test/markdown.test.ts`).
  Qualquer mudança no Markdown precisa manter esse teste verde.
- Toda alteração de apresentação passa por `applyOps` (atômico, incrementa `version`, devolve
  `touched` para o rebase por elemento).
- A marcação gerada pelo renderer (`p`, `ul/ol > li > p`, `a > span[data-color] > mark[data-hl] >
  strong > em > u > s > sup/sub`) é contrato com o editor (TipTap) e com `domToRichText`.
- O HTML exportado renderiza em tempo de execução a partir do JSON embutido
  (`<script type="application/json" id="presentation">`), com CSP por hash do script.
- Ícones e fontes do export: só os usados são embutidos.

## Convenções

- TypeScript estrito (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). TypeScript fixado
  em 6.x porque o typescript-eslint ainda não suporta o 7.
- Identificadores do schema, mensagens para a IA e comentários de código em **inglês**; textos de
  interface para o usuário em **português do Brasil**.
- Mensagens de erro de validação: caminho do campo + como corrigir (`formatIssues`).
- CSS do slide sempre escopado em `.deck`; tamanhos em px no canvas lógico (1920×1080 ou
  1440×1080), escalado por `transform`.
- Pacotes de navegador não podem importar Node nem Zod (o build do player avisa se Zod entrar).
- No servidor, stdout é do protocolo MCP: logs sempre em stderr (`console.log` é redirecionado).
- Mensagens das tools e avisos de design para a IA em inglês; `DesignWarning.pt` é a versão
  mostrada no editor.
- Imagens do usuário são servidas em `/media/:id` (`/assets/` é dos arquivos do Vite).
- Segurança do modo remoto: nunca redirecionar para `redirect_uri` antes de validá-lo contra o
  cliente; `next` só aceita caminhos relativos; tokens e códigos são guardados apenas como hash;
  toda consulta de apresentação filtra por `owner`.

## Comandos

```bash
pnpm install
pnpm test            # vitest (core, renderer, server)
pnpm test:e2e        # Playwright: player + fluxo MCP→editor→download (compila tudo; usa o Google Chrome)
pnpm typecheck
pnpm lint
pnpm examples        # out/examples/*.html
pnpm mcpb            # out/slideia-<versão>.mcpb (Claude Desktop)
./iniciar.sh --editor   # editor local com exemplos (http://127.0.0.1:47800)
./iniciar.sh --mcp      # compila o servidor e mostra como conectar ao Claude Code / Desktop / Gemini
./iniciar.sh --remoto   # servidor remoto simulado (PGlite), http://localhost:8787
./iniciar.sh --docker   # Postgres + S3 (SeaweedFS) + Mailpit + servidor
pnpm render arquivo.json -o saida.html [--assets pasta]
./deploy/vps/deploy.sh  # publica em https://slideia.site (testes locais → rsync → build na VPS)
```
