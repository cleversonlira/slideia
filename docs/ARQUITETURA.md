# [NOME] — Plano de arquitetura

> Status: aprovado · Fase 1 implementada em 2026-10-18 (ver §17 para o que mudou na implementação)
> Base: `prompt-ferramenta-apresentacoes.md`. Este documento fixa as decisões **antes** do código. O que estiver marcado com ⚠️ precisa ser confirmado no momento da implementação (APIs externas que mudam rápido) ou depende de uma decisão sua.

---

## 0. Decisões-chave (resumo)

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | **Slides baseados em layouts com "slots"**, sem coordenadas x/y | É o que a IA gera bem; garante consistência visual; elimina sobreposição. Posicionamento livre fica no roadmap. |
| D2 | **Canvas lógico fixo** (1920×1080 para 16:9, 1440×1080 para 4:3), escalado com `transform: scale` | Mesmo resultado em editor, player, preview e PDF, independentemente da tela. |
| D3 | **Renderer em TypeScript puro (sem framework)**: funções `Presentation → string HTML` + CSS do tema | Roda igual no player (arquivo offline, leve), no editor (React injeta o HTML) e no servidor (preview/export). É o que garante "editado = apresentado". |
| D4 | **O HTML exportado renderiza em tempo de execução** a partir do JSON embutido | Fonte única; permite a edição rápida (tecla E) e regravar o arquivo; reimportação trivial. |
| D5 | **Toda mutação passa por operações (`ops`)** definidas no `core` — tanto da IA (`apply_edits`) quanto do editor (autosave) | Um único caminho de escrita: validação, histórico, `get_changes`, merge e auditoria "você/IA" saem de graça. |
| D6 | **Concorrência otimista com rebase por elemento** | Se a IA e o usuário mexeram em elementos diferentes, o servidor aplica sem conflito; só retorna conflito quando o mesmo elemento foi alterado. |
| D7 | **Markdown estendido com ida e volta sem perdas** ⇄ texto rico estruturado | A IA lê e escreve Markdown (economiza muito token); o armazenamento é sempre o formato estruturado. Testado com property-based tests. |
| D8 | **MCP em HTTP streamable *stateless*** (sem sessão), autenticado por bearer token | Escala horizontal simples e compatível com ChatGPT/Claude. |
| D9 | **Better Auth** para contas (e-mail+senha, verificação, Google) + plugin de provedor OAuth 2.1 para MCP ⚠️ | Evita escrever um servidor OAuth do zero. Plano B: `oidc-provider` (panva). Ver §6. |
| D10 | **Kysely** como query builder (Postgres e SQLite com as mesmas consultas) | Um repositório só para os modos remoto e local. |
| D11 | **Identificadores do schema em inglês**, interface em pt-BR | Enums/descrições em inglês são mais naturais para os modelos e para o código; tudo o que o usuário vê é pt-BR. |
| D12 | **`preview` retorna PNG + avisos estruturados** (estouro de texto, contraste) medidos no navegador headless | A IA corrige com muito mais precisão a partir de "elemento e_3 do slide 5 excede 38% da altura" do que de uma imagem. |

---

## 1. Stack

| Camada | Escolha |
|--------|---------|
| Runtime | Node.js 24 LTS, pnpm workspaces, TypeScript 6.x estrito (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — o 7.x ainda não é suportado pelo typescript-eslint |
| Build | `tsup` (pacotes de biblioteca), Vite (editor, widget, player) |
| Validação | Zod 4 (+ `z.toJSONSchema` para exportar o JSON Schema) |
| MCP | `@modelcontextprotocol/sdk` (TS oficial) + extensão MCP Apps (`@modelcontextprotocol/ext-apps`) ⚠️ versões |
| Servidor HTTP | Express 5 (melhor suporte nos exemplos/helpers do SDK MCP) |
| Banco | Postgres 16+ (remoto) / SQLite com WAL via `better-sqlite3` (local); Kysely; migrações por dialeto |
| Arquivos | Interface `BlobStore` com implementações disco e S3-compatível (AWS S3, R2, Tigris, MinIO) |
| Imagens | `sharp` (resize, compressão, WebP/JPEG, remoção de EXIF) |
| Preview | Playwright (Chromium) em pool de workers com limite de concorrência |
| Editor | React 19, Vite, TipTap 3, Zustand, TanStack Query, TanStack Router, dnd-kit, react-easy-crop |
| Site | Astro (estático) |
| Testes | Vitest, fast-check (property-based), Playwright e2e, MCP Inspector |
| Qualidade | ESLint (flat config, typescript-eslint), Prettier |
| Observabilidade | pino (logs JSON), métricas Prometheus em `/metrics` (protegido) |
| E-mail | Interface `Mailer` (SMTP / Resend / SES) ⚠️ escolha sua |

---

## 2. Estrutura do monorepo

```
/
├── packages/
│   ├── core/          # schema, markdown⇄richtext, temas, layouts, ops, diff, regras de design
│   ├── renderer/      # Presentation → HTML; CSS de temas/layouts; player; export autocontido
│   ├── editor/        # SPA React (editor) + entry separado do widget de chat
│   ├── server/        # MCP (http+stdio), OAuth, REST do editor, SSE, preview, armazenamento
│   └── site/          # Astro: landing, como conectar, suporte, privacidade, termos
├── assets/
│   ├── fonts/         # woff2 OFL versionadas no repo (nada é baixado em runtime)
│   └── examples/      # apresentações de exemplo (JSON) usadas em testes, resources e conta demo
├── docs/              # este plano, guia do usuário, material de submissão
├── e2e/               # testes Playwright ponta a ponta
├── skills/            # SKILL.md (Claude Code), AGENTS.md, GEMINI.md
├── mcpb/              # manifest do pacote .mcpb (Claude Desktop)
├── Dockerfile, docker-compose.yml, fly.toml
└── CLAUDE.md / AGENTS.md
```

Dependências entre pacotes (sem ciclos):

```
core  ←  renderer  ←  editor
  ↑         ↑
  └──── server ─────→ (serve o build do editor e do site)
```

`core` e `renderer` **não** dependem de Node nem de DOM em tempo de import (rodam no navegador, no servidor e dentro do HTML exportado).

---

## 3. Presentation Schema (rascunho)

Formato armazenado (normalizado). A entrada da IA aceita variações mais convenientes (ver §3.4).

```ts
type Presentation = {
  schemaVersion: 1;                 // versão do formato (migrações do schema)
  id: string;                       // "p_" + nanoid
  version: number;                  // inteiro, +1 a cada alteração aceita
  meta: {
    title: string;
    author?: string;
    lang: string;                   // BCP 47, ex. "pt-BR" — usado no spellcheck e no <html lang>
    aspectRatio: "16:9" | "4:3";
    theme: ThemeId;
    themeOverrides?: { accent?: Hex; fontHeading?: FontId; fontBody?: FontId };
    defaultTransition: Transition;
  };
  slides: Slide[];
};

type Slide = {
  id: string;                       // "s_" + id curto, estável
  layout: LayoutId;
  variant?: string;                 // ex. imagem à esquerda/direita
  elements: Element[];              // cada elemento ocupa um slot do layout
  background?: Background;          // cor do tema | hex | gradiente do tema | imagem (asset) com overlay
  transition?: Transition;          // sobrescreve a padrão
  notes?: RichText;                 // anotações do apresentador (roteiro de fala)
  hidden?: boolean;
};

type ElementBase = {
  id: string;                       // "e_" + id curto, estável
  slot: string;                     // nome do slot no layout (ex. "title", "body", "left")
  animation?: { type: "fade" | "rise" | "zoom" | "wipe"; order: number; by?: "element" | "paragraph" };
};

type Element = ElementBase & (
  | { type: "title";    text: RichText }
  | { type: "text";     text: RichText }                 // inclui listas (parágrafos com list)
  | { type: "image";    asset: AssetRef; alt: string; fit: "cover" | "contain";
                        crop?: Rect; focal?: Point; kenBurns?: boolean; caption?: RichText }
  | { type: "icon";     name: LucideName; color?: ColorRef; size?: "sm" | "md" | "lg" }
  | { type: "chart";    kind: "bar" | "line" | "pie" | "donut"; title?: string;
                        labels: string[]; series: { name: string; values: number[]; color?: ColorRef }[];
                        unit?: string; showValues?: boolean }
  | { type: "table";    header: RichText[]; rows: RichText[][]; highlightFirstColumn?: boolean }
  | { type: "quote";    text: RichText; author?: string; role?: string }
  | { type: "stat";     value: string; label: RichText; icon?: LucideName; trend?: "up" | "down" }  // KPIs
  | { type: "timeline"; items: { date: string; title: string; text?: RichText }[] }
);
```

> Acréscimos em relação ao prompt: os elementos `stat` (para o layout de números/KPIs) e `timeline` (linha do tempo). Sem eles, esses dois layouts dependeriam de convenções frágeis em listas.

> "Lista" não é um tipo separado: é um `text` cujos parágrafos têm `list`. Isso permite misturar parágrafo e lista e simplifica o editor (o TipTap trata tudo como um documento).

### 3.1 Texto rico restrito

```ts
type RichText = { paragraphs: Paragraph[] };

type Paragraph = {
  runs: Run[];
  align?: "left" | "center" | "right" | "justify";
  list?: { kind: "bullet" | "ordered"; level: 1 | 2 | 3 };
  size?: "small" | "normal" | "large" | "display";      // escala do tema
};

type Run = {
  text: string;                                          // texto puro; nunca HTML
  marks?: {
    bold?: true; italic?: true; underline?: true; strike?: true;
    color?: ColorRef;                                    // token do tema ("accent", "muted"...) ou "#rrggbb"
    highlight?: ColorRef;
    link?: { href: string };                             // só http(s) e mailto
    script?: "sup" | "sub";
  };
};
```

Invariantes, garantidas pela normalização: runs adjacentes com as mesmas marcas são fundidos; não existem runs vazios; quebras de linha `\n` dentro de um run viram `<br>` (soft break).

### 3.2 Markdown estendido (D7)

Subconjunto CommonMark + extensões mínimas, **com ida e volta sem perdas** (`richTextToMd(mdToRichText(x)) ≡ x` normalizado, e vice-versa):

| Recurso | Sintaxe |
|--------|---------|
| negrito / itálico / tachado | `**a**` `*a*` `~~a~~` |
| sublinhado | `++a++` |
| destaque | `==a==` (cor padrão) ou `[a]{highlight=yellow}` |
| cor | `[a]{color=accent}` / `[a]{color=#d33}` (spans no estilo Pandoc) |
| sobrescrito / subscrito | `^a^` / `~a~` |
| link | `[a](https://…)` |
| listas | `-` / `1.` com recuo de 2 espaços por nível (máx. 3) |
| alinhamento / tamanho do parágrafo | atributo no fim da linha: `Texto {align=center size=large}` |

Qualquer HTML na entrada é tratado como texto literal (escapado), nunca interpretado.

### 3.3 Layouts e slots

| LayoutId | Slots (obrigatórios em **negrito**) | Capacidade orientativa |
|----------|-------------------------------------|------------------------|
| `cover` | **title**, subtitle, image (fundo), logo | título ≤ 60 caracteres |
| `section` | **title**, subtitle, number | |
| `title-content` | **title**, **body** | ≤ 6 itens / ~60 palavras |
| `two-columns` | **title**, **left**, **right** | |
| `full-image` | **image**, caption, title | |
| `image-text` (variant `left`\|`right`) | **title**, **image**, **body** | |
| `quote` | **quote**, image | ≤ 240 caracteres |
| `stats` | title, **stats** (2–4 `stat`) | |
| `timeline` | title, **timeline** (3–7 itens) | |
| `comparison` | **title**, **leftTitle**, **left**, **rightTitle**, **right** | |
| `chart` | **title**, **chart**, body | |
| `table` | **title**, **table** | ≤ 7 linhas × 5 colunas |
| `closing` | **title**, body, contact | |

Cada layout é um `grid-template-areas` em CSS. Cada slot declara quais tipos de elemento aceita e qual a capacidade orientativa, que alimenta os avisos de design.

### 3.4 Entrada amigável para a IA (normalização no servidor)

- Qualquer campo `RichText` aceita `string` (Markdown estendido) ou o objeto estruturado.
- `id` é opcional ao criar: o servidor gera. Ids informados pela IA são aceitos se forem únicos e válidos.
- `slot` é opcional quando o layout tem um único slot compatível com o tipo (ex. `title` → slot `title`).
- `animation.order` é opcional: a ordem dos elementos vira a ordem de entrada.
- Imagens: `asset` aceita `"asset:<id>"` ou uma URL; URLs são baixadas na criação (com as proteções do §9) e convertidas em asset.

### 3.5 Transições e animações

```ts
type Transition = {
  type: "none" | "fade" | "slide" | "push" | "zoom" | "dissolve" | "flip3d" | "cube3d" | "reveal";
  direction?: "left" | "right" | "up" | "down";         // slide, push, reveal, flip3d, cube3d
  durationMs?: number;                                   // 200–2000, padrão 600
};
```

- Animações de entrada: cada "avançar" revela o próximo grupo de `animation.order`. Com `by: "paragraph"`, cada item de lista entra separado.
- Ken Burns: `image.kenBurns = true` aplica zoom/pan lento enquanto o slide está visível (o ponto focal define a direção).

### 3.6 Temas (8 iniciais)

`executivo` (azul-marinho, sóbrio), `minimal` (branco/preto), `noturno` (escuro), `corporativo` (cinza + accent), `vibrante` (cores saturadas), `editorial` (serifa, revista), `natureza` (verdes terrosos), `tech` (escuro + neon contido).

Cada tema define: paleta por tokens (`bg`, `surface`, `text`, `muted`, `accent`, `accent2`, `highlight`, `chart1…6`), fontes (título e corpo), escala tipográfica, espaçamentos, raio de borda e estilo de fundo. Um teste automatizado verifica o contraste WCAG AA de todo par texto/fundo de cada tema. Fontes: woff2 OFL com subset latino, embutidas apenas as usadas.

### 3.7 Versionamento do schema

`schemaVersion` + funções de migração em `core/migrations` aplicadas ao ler documentos antigos (inclusive JSON reimportado de HTML exportado).

---

## 4. Operações de edição (`core/ops`)

Funções puras e atômicas: `applyOps(pres, ops) → { pres, touched: Set<elementOrSlideId>, summary, warnings }`. Ou todas as operações são aplicadas, ou nenhuma. Os erros indicam a operação, o caminho e uma sugestão de correção.

| Op | Parâmetros |
|----|-----------|
| `update_text` | `slide, element, text` (RichText ou Markdown) — texto principal (título/texto/citação, legenda, rótulo do KPI) |
| `update_element` | `slide, element, patch` (merge parcial; dados de gráfico, células de tabela, ícone, slot, animação; `null` remove) |
| `add_element` / `remove_element` | `slide, element, before?` / `slide, element` |
| `reorder_elements` | `slide, order: elementId[]` |
| `update_slide` | `slide, patch` (layout, variant, background, transition, notes, hidden; `null` remove) |
| `add_slide` | `slide, after?: slideRef \| "start"` |
| `remove_slide` / `duplicate_slide` | `slide` / `slide, after?` |
| `replace_slide` | `slide, with` (reescreve o slide mantendo o id; usado pelo diff em trocas de layout) |
| `reorder_slides` / `move_slide` | `order: slideRef[]` (completa) / `slide, after` |
| `update_presentation` | `patch` em `meta` (tema, proporção, transição padrão, título…) |
| `find_replace` | `find, replace, matchCase?, wholeWord?, scope?: "all" \| slideId[]` |
| `set_image` | `slideId, elementId, source: url \| "asset:<id>", alt?` |

Os slides podem ser referenciados por `slideId` ou `slideNumber` (base 1). Os números são resolvidos para ids **antes** de aplicar a primeira operação, para que uma reordenação no meio do lote não mude o alvo das seguintes.

Troca de layout: os elementos são remapeados para os slots do novo layout pelo tipo. O que não couber é preservado num slot `overflow` oculto e gera um aviso (nada se perde silenciosamente).

`diffToOps(a, b)`: gera operações a partir de dois estados. É usado pelo editor (autosave e desfazer/refazer) e pelo `get_changes`.

### 4.1 Concorrência (D6)

1. Cada versão aceita grava em `presentation_versions`: snapshot, autor (`user` | `ai`), canal (`editor` | `mcp`), resumo e conjunto `touched`.
2. `apply(expectedVersion = v, ops)` com versão atual `c`:
   - se `v == c`, aplica;
   - se `v < c`, junta os `touched` das versões `v+1..c`. Se nenhuma operação nova toca esses ids, aplica sobre `c` (rebase automático) e responde `rebased: true`;
   - caso contrário, retorna **conflito** com os ids em choque, quem os alterou e quando.
3. A IA recebe no conflito uma instrução objetiva: "chame `get_presentation` e refaça as operações nos elementos X, Y".
4. No editor, o usuário pode **recarregar** (descarta o local) ou **mesclar** (mantém o local nos elementos em conflito, ou o do servidor, elemento a elemento).
5. Retenção: últimas 200 versões por apresentação, mais uma por dia nos últimos 90 dias (configurável).

---

## 5. Servidor MCP

### 5.1 Tools

| Tool | Annotations | Retorno (compacto) |
|------|-------------|--------------------|
| `get_guide` | readOnly | Schema resumido (~2–3k tokens), layouts/slots, temas, transições, regras de design, exemplo mínimo |
| `create_presentation(presentation)` | write, não destrutiva | `id, version, slides: [{n, id, title}], warnings[], editorUrl, downloadUrl` |
| `get_presentation(id, format: "outline" \| "full")` | readOnly | outline: Markdown com ids (`## 3 · s_x9 · title-content`), textos e notas; full: JSON com texto rico em Markdown |
| `list_presentations(query?, limit?)` | readOnly | `[{id, title, slides, updatedAt}]` |
| `apply_edits(id, expectedVersion, operations[])` | write, **destrutiva** (remove/sobrescreve) | `version, rebased, summary, warnings[]` |
| `add_image(id, source, alt?)` | write | `asset: "asset:<id>", width, height` |
| `get_changes(id, sinceVersion)` | readOnly | Lista legível das edições do usuário: "slide 4: título alterado de 'X' para 'Y'" |
| `preview(id, slideNumber?)` | readOnly | PNG 960×540 (um slide, ou mosaico 3×N de miniaturas) + `issues[]` estruturados |
| `render(id)` | readOnly* | `downloadUrl` (expira em 24 h), `sizeBytes` |
| `open_editor(id, slideNumber?)` | readOnly | `editorUrl`, `presentUrl` |

\* `render` grava um arquivo temporário, mas não altera dados do usuário; é marcado como readOnly. ⚠️ Confirmar se o ChatGPT trata isso como esperado.

- Todas as tools têm `openWorldHint: false`, exceto `add_image` e `set_image` via URL (`openWorldHint: true`, porque acessam a internet).
- As descrições dizem o que a tool faz, quando usar e o que retorna. A de `create_presentation` diz "chame `get_guide` antes, se ainda não chamou nesta conversa": é uma instrução factual de uso, não manipulação.
- Os erros de validação viram `isError: true` com uma lista do tipo `slides[4].elements[1].text: obrigatório para type="title" — envie uma string Markdown`.
- `structuredContent` + texto curto em todas as respostas. O conteúdo grande vai só no `structuredContent` usado pelo widget.

### 5.2 Prompts e resources

- Prompts: `criar_apresentacao(tema, publico?, duracao?, tom?)` e `apresentacao_a_partir_de_documento(documento)`. Ambos codificam o fluxo briefing → roteiro para aprovação → criação → preview → links.
- Resources: `schema://presentation.json` (JSON Schema), `guide://design.md`, `example://<slug>.json` (3 exemplos completos).

### 5.3 UI no chat (MCP Apps) ⚠️

- Bundle separado (`editor/src/widget`), um único HTML com o renderer embutido, registrado como resource `ui://[nome]/viewer.html` (mime `text/html;profile=mcp-app`).
- Vinculado a `create_presentation`, `apply_edits`, `get_presentation` e `open_editor` via `_meta.ui.resourceUri`, mais as chaves equivalentes do Apps SDK (`openai/outputTemplate`) enquanto o ChatGPT exigir.
- Mostra um carrossel de slides com setas e swipe, e os botões **Abrir editor**, **Apresentar** e **Baixar HTML** (todos links externos assinados).
- As imagens chegam por URL assinada (não base64), declarada na CSP do widget.
- Layout pensado primeiro para mobile (largura do chat do app do ChatGPT).

### 5.4 Modos de execução

**Remoto:** `POST/GET https://<domínio>/mcp`, stateless, com `Authorization: Bearer`. Sem token, responde `401` com `WWW-Authenticate: Bearer resource_metadata="https://<domínio>/.well-known/oauth-protected-resource"`.

**Local (stdio):** `npx @[nome]/mcp`
- SQLite em `~/Apresentacoes/.[nome]/data.sqlite` (WAL), assets em `~/Apresentacoes/.[nome]/assets/`, e `render` grava `~/Apresentacoes/<titulo>.html`. A pasta é configurável por `[NOME]_HOME`.
- O processo stdio também abre um HTTP em `127.0.0.1`, tentando a porta 47800 e caindo para uma aleatória se estiver ocupada. A URL do editor leva um `?t=<token>` de uso único, trocado por cookie `HttpOnly` e removido da URL.
- Vários processos ao mesmo tempo (várias sessões do Claude Code) são suportados: o SQLite em WAL aguenta múltiplos processos, e o SSE do editor faz polling barato de `version` (1 s) em vez de depender de eventos em memória.
- `.mcpb`: manifest com `npx`/node empacotado, pedindo a pasta como configuração do usuário.

---

## 6. Autenticação e contas

### 6.1 Requisitos (spec de autorização do MCP)

- `/.well-known/oauth-protected-resource` (RFC 9728) → `authorization_servers: ["https://<domínio>"]`, `scopes_supported`.
- `/.well-known/oauth-authorization-server` (RFC 8414) e OIDC discovery.
- Authorization Code + **PKCE S256 obrigatório**, sem implicit e sem password grant.
- **DCR** (RFC 7591) aberto, com rate limit e limpeza de clients sem uso.
- **CIMD** (Client ID Metadata Document): `client_id` sendo uma URL HTTPS; o servidor busca o documento com proteção anti-SSRF, cache e validação de `redirect_uris`. ⚠️
- **Resource indicators** (RFC 8707): token com `aud = https://<domínio>/mcp`, validado em toda requisição.
- Access token JWT (ES256) de 1 h; refresh token opaco com rotação e detecção de reuso.
- Scopes: `presentations:read`, `presentations:write`.

### 6.2 Implementação

- **Better Auth**: e-mail+senha (argon2id), verificação de e-mail, recuperação de senha, login com Google e sessões do editor (cookie `HttpOnly`, `SameSite=Lax`).
- Provedor OAuth para MCP: plugin do Better Auth. ⚠️ Antes da Fase 3, validar no Inspector e no ChatGPT se ele cobre DCR, CIMD e RFC 8707. Se faltar CIMD, implementar um resolvedor de `client_id`-URL (~150 linhas) sobre ele. Se o plugin for insuficiente, a alternativa é o `oidc-provider`.
- Telas de login, cadastro, consentimento ("O ChatGPT quer acessar suas apresentações: ler / criar e editar") e conta em pt-BR, servidas pelo próprio servidor (React, mesmo design system do editor).
- LGPD: exportar meus dados (zip com JSONs e assets) e excluir conta. A exclusão remove dados e blobs na hora e revoga todos os tokens.

### 6.3 Limites (configuráveis por env e por plano)

Apresentações por conta (padrão 100), slides por apresentação (100), imagem ≤ 10 MB na entrada e ≤ 2560 px após o resize, armazenamento por conta (500 MB), previews por hora (60), chamadas de tool por minuto (60).

---

## 7. Editor visual

### 7.1 Renderização compartilhada (D3) e edição no lugar

- O canvas do slide é o HTML do renderer escalado.
- Ao clicar num elemento de texto, o editor monta um TipTap **sobre o mesmo nó**, com as mesmas classes CSS. Os `renderHTML` das extensões TipTap são configurados para emitir **exatamente** o mesmo markup que o serializer de texto rico do renderer.
- Um teste de paridade garante isso: para N documentos aleatórios (fast-check), `renderer.richTextToHtml(doc) === tiptapHtml(doc)`.
- O schema do TipTap aceita só as marcas e nós do §3.1. Colar de Word/web passa por `transformPastedHTML`, que converte para RichText e descarta o resto.
- Barra flutuante: negrito, itálico, sublinhado, cor (tokens + seletor), destaque, link, alinhamento, listas, recuo, tamanho e limpar formatação. Atalhos: Ctrl+B/I/U/K, Ctrl+Z/Y, Tab/Shift+Tab.
- Autofit: depois do render, mede `scrollHeight` contra a altura do slot e reduz `--fit` em passos de 5% até o mínimo de 70%. Abaixo disso, mostra um contorno vermelho e o aviso "texto estourando". O **mesmo algoritmo** roda no player e no preview, e as fontes embutidas garantem medidas iguais.
- `spellcheck` com `lang` = `meta.lang`.
- Tabelas: célula a célula (mini-TipTap por célula). Gráficos: painel com grade de dados (rótulos × séries) e título editável no lugar.

### 7.2 Telas e recursos

- **Minhas apresentações**: lista, busca, criar em branco, duplicar, excluir e importar (JSON ou HTML exportado).
- **Editor**: miniaturas à esquerda (dnd-kit: reordenar, duplicar, excluir, adicionar com seletor de layout), canvas central, painel de propriedades à direita (layout, tema, fundo, transição com pré-visualização, animações) e anotações abaixo.
- **Modo roteiro**: lista vertical por slide com título, campos de texto (mini-TipTap cada) e notas. A alteração gera as mesmas operações que a edição no canvas.
- Imagens: upload, arrastar e soltar, colar e URL. O corte (react-easy-crop) é **não destrutivo** (`crop` + `focal` no schema).
- Localizar e substituir: usa a op `find_replace` com pré-visualização das ocorrências.
- Desfazer/refazer: pilha local de estados. Cada passo vira operações via `diffToOps`. Dentro de um texto em edição, vale o histórico do próprio TipTap.
- Autosave: debounce de 1 s. Envia as operações acumuladas com `expectedVersion`. Indicador **Salvo / Salvando… / Offline / Conflito**.
- Histórico de versões: linha do tempo com autor ("você" / "IA"), resumo, visualização e restaurar (a restauração cria uma nova versão, não apaga o histórico).
- Botões: Apresentar (abre o player em tela cheia), Baixar HTML, Exportar JSON, Imprimir/PDF.
- Responsivo: no tablet, edição completa com painéis recolhíveis; no celular, editar textos, notas, reordenar e apresentar.

### 7.3 Tempo real

- `GET /api/presentations/:id/events` (SSE) envia `{version, author, touched}`.
- Sem alterações locais pendentes: o editor busca a nova versão, aplica e destaca os elementos de `touched` por 2 s (contorno + selo "IA").
- Com alterações pendentes: o próximo save é rebaseado no servidor (§4.1).
- No modo remoto com várias instâncias, a difusão de eventos usa `LISTEN/NOTIFY` do Postgres.

---

## 8. Renderer e player

### 8.1 Renderer

- `renderSlide(slide, ctx) → string`, `renderPresentationCss(theme, aspect) → string` e `richTextToHtml(rt) → string`. Todo texto passa por escape; não existe caminho para HTML cru.
- Gráficos: SVG gerado à mão (barras, linhas, pizza/rosca), com eixos, rótulos e paleta do tema. Sem biblioteca, para manter o export leve.
- Ícones Lucide: só os SVGs usados são embutidos no export.

### 8.2 Player

- Vanilla TS, empacotado como IIFE e minificado (meta: < 60 KB gz sem fontes).
- Máquina de estados `idle → transitioning → idle`, com fila de no máximo 1 comando, ignorando `event.repeat`.
- Cada slide tem `steps` = número de grupos de animação. "Avançar" percorre os steps e depois troca de slide; "voltar" faz o inverso, entrando no slide anterior já com todos os steps visíveis.
- Transições com duas camadas (atual/próximo) e Web Animations API, só com `transform`/`opacity`. 3D usa `perspective` no container. Com `prefers-reduced-motion`, tudo vira `fade` curto.
- Pré-render do slide seguinte e anterior (DOM pronto e imagens decodificadas com `img.decode()`).
- Teclas: conforme o prompt, mais a **tela de teste (T)** com `key`/`code` recebidos e remapeamento salvo em `localStorage`.
- Tela cheia: F5 / Shift+F5 com `preventDefault`. Cursor oculto após 2 s.
- **Visão do apresentador**: `window.open(sameFile + "#presenter")`. A comunicação usa principalmente `postMessage` via `window.opener` e, como alternativa, `BroadcastChannel`. Motivo: em `file://`, a origem é opaca e o `BroadcastChannel` pode não funcionar entre janelas em alguns navegadores. O `opener` funciona sempre. Os comandos do passador funcionam nas duas janelas.
- Impressão: `@media print` com um slide por página no tamanho do canvas e todos os steps visíveis.
- **Edição rápida (E)**: torna `contentEditable` os textos (marcas preservadas, colagem como texto puro). Ao salvar, converte o DOM em RichText (o mesmo parser do editor), atualiza o JSON embutido e regrava o arquivo via File System Access API (Chrome/Edge) ou download de um novo `.html`.

### 8.3 Export autocontido

```html
<!doctype html><html lang="…">
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'sha256-…'">
  <style>/* fontes base64 + tema + layouts */</style>
</head>
<body>
  <script type="application/json" id="presentation">{…JSON com imagens como data URIs…}</script>
  <script>/* player + renderer */</script>
</body></html>
```

- O hash da CSP é calculado sobre o script inline no build do export.
- Links dos slides abrem em nova aba com `rel="noopener noreferrer"`. A CSP bloqueia qualquer requisição externa.
- Meta de tamanho: < 400 KB + imagens. Imagens são reencodadas a ≤ 1920 px para o export.

---

## 9. Segurança

- **Texto**: nunca há HTML cru; escape em toda saída; URLs de link só `http`, `https` e `mailto`.
- **Imagens por URL (SSRF)**: só `https`/`http` nas portas 80/443. O DNS é resolvido **antes** e o IP é validado (bloqueio de privados, loopback, link-local, CGNAT, metadata `169.254.169.254`, IPv6 ULA). A conexão vai ao IP validado, com no máximo 3 redirects, cada um revalidado. Timeout de 10 s, tamanho máximo antes de baixar (Content-Length) e durante o stream. O tipo é verificado por magic bytes. O `sharp` reencoda tudo, o que elimina payloads embutidos. SVG não é aceito como imagem enviada.
- **Isolamento**: toda query recebe `userId` do token. Os ids são aleatórios e impossíveis de adivinhar, mas nunca são a única barreira. Há testes de autorização cruzada.
- **Links assinados** (download, apresentar): HMAC com expiração (24 h), revogáveis por rotação de chave.
- **Rate limiting** por usuário e por IP (login, DCR, tools).
- **Headers**: CSP rígida no editor, HSTS, `frame-ancestors` restrito (exceto onde o widget exige).
- **Segredos** só em variáveis de ambiente. Logs nunca registram conteúdo de apresentação nem tokens.

---

## 10. Dados (tabelas principais)

```
users, accounts, sessions, verifications          # Better Auth
oauth_clients, oauth_codes, oauth_tokens          # provedor OAuth
presentations(id, user_id, title, version, doc jsonb, schema_version, created_at, updated_at, deleted_at)
presentation_versions(presentation_id, version, author, channel, summary, touched text[], doc jsonb, created_at)
assets(id, user_id, presentation_id?, blob_key, mime, width, height, bytes, sha256, created_at)
usage_counters(user_id, metric, window_start, count)
```

`doc` no SQLite é `TEXT` com JSON. Os assets são deduplicados por `sha256` por usuário.

---

## 11. Observabilidade

- Log por chamada de tool: `tool`, `userId` (hash), `durationMs`, `ok`/`errorCode`, `slides`, `opsCount`. Nunca textos.
- Métricas: latência e erro por tool, conflitos e rebases, duração do preview, fila de previews, bytes de assets.
- `/healthz` (liveness) e `/readyz` (banco + blob store).

---

## 12. Testes

| Nível | O quê |
|-------|-------|
| Unit (core) | Schema (válidos/inválidos com mensagens), normalização, Markdown⇄RichText (property-based, ida e volta), cada op, `diffToOps` (aplicar o diff de a→b em a resulta em b), rebase/conflito, migrações |
| Unit (renderer) | Snapshots HTML por layout e tema, escape/XSS (corpus de payloads), contraste dos temas, CSP hash |
| Paridade | `richTextToHtml` vs. HTML do TipTap (fast-check) |
| Server | Tools via cliente do SDK MCP em memória, OAuth (discovery, DCR, PKCE, audience, refresh com rotação), isolamento entre usuários, SSRF (servidor DNS falso) |
| Visual | Screenshots Playwright de cada layout × tema, com tolerância |
| E2E | Criar via MCP → editar texto no editor → baixar HTML → abrir o arquivo → navegar com PageDown/PageUp/B/F5 → visão do apresentador sincronizada |
| Manual | MCP Inspector; ChatGPT em modo desenvolvedor; Claude (conector remoto, Desktop .mcpb, Code); Gemini CLI |

---

## 13. Deploy

- Uma imagem Docker (base com Chromium do Playwright) que serve MCP, API, editor, widget e site.
- Fly.io (recomendado): app com 2 máquinas, Postgres gerenciado, S3 via Tigris e um process group `preview` separado para isolar o Chromium (memória). Alternativas: Railway ou VPS com docker-compose (Postgres + MinIO + Caddy para TLS).
- Variáveis principais: `PUBLIC_URL`, `DATABASE_URL`, `BLOB_DRIVER`/`S3_*`, `AUTH_SECRET`, `JWT_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`/`SECRET`, `MAIL_*`, `SIGNING_KEY`, `OPENAI_APPS_CHALLENGE_TOKEN`, `LIMIT_*`, `DEMO_ACCOUNT_EMAIL`.
- `/.well-known/openai-apps-challenge` retorna `OPENAI_APPS_CHALLENGE_TOKEN` em `text/plain`.

---

## 14. Fases (refinadas)

### Fase 1 — core + renderer
Monorepo, lint, CI; schema + normalização + Markdown estendido; 13 layouts; 8 temas; ops + diff; regras de design; renderer; player completo; export autocontido; CLI de dev `pnpm render exemplo.json > out.html`; 3 exemplos.
**Como testar:** gerar o HTML de cada exemplo, abrir offline e apresentar com o passador (tela T para conferir as teclas), visão do apresentador e impressão em PDF.

### Fase 2 — server local (stdio) + editor local
Repositório SQLite, BlobStore em disco; tools MCP; prompts/resources; preview com Playwright; REST + SSE; editor completo sem login (token local).
**Como testar:** `claude mcp add [nome] -- npx …` (link local), pedir uma apresentação de 10 slides, abrir o editor, editar um texto, ver a IA alterar outro slide em tempo real e baixar o HTML.

### Fase 3 — remoto + OAuth + Postgres + login
Postgres + S3; Better Auth + OAuth MCP; telas de login/consentimento; isolamento; limites; rate limiting; links assinados; Docker + deploy.
**Como testar:** MCP Inspector (fluxo OAuth completo); ChatGPT em modo desenvolvedor → conectar → repetir o fluxo da Fase 2; Claude web com conector personalizado.

### Fase 4 — chat UI + publicação
Widget MCP Apps; site Astro (landing, como conectar, suporte, privacidade, termos); conta demo com seed; material de submissão (descrição, 5 casos positivos e 3 negativos, roteiro de vídeo, notas da versão); `.mcpb`; SKILL.md/AGENTS.md/GEMINI.md; guia do usuário.
**Como testar:** widget no ChatGPT web e mobile e no Claude; instalação do `.mcpb` no Claude Desktop; checklist de submissão da OpenAI.

---

## 15. Riscos e pontos em aberto

| Item | Risco/decisão | Mitigação |
|------|---------------|-----------|
| Nome e domínio | Necessários para pacotes npm, OAuth, verificação OpenAI | **Decisão sua** antes da Fase 2 (uso `[nome]` até lá) |
| CIMD / plugin OAuth | Suporte de bibliotecas ainda em evolução | Spike no início da Fase 3; plano B `oidc-provider` |
| MCP Apps / Apps SDK | Spec recente; chaves `_meta` podem mudar | Isolar num módulo `ui-bindings`; revisar a doc oficial ao iniciar a Fase 4 |
| Confirmações no ChatGPT | Cada escrita pede confirmação | `apply_edits` em lote; `create_presentation` já com tudo; guia orienta a agrupar |
| Custo do Chromium (preview) | Memória e CPU | Pool limitado, cache por `(id, version, slide)`, process group separado, limite por hora |
| Imagens | A IA não gera imagens; URLs inventadas falham | Erro claro "URL não acessível"; usuário envia no editor; banco de imagens no roadmap |
| Arquivos enviados no chat | Apps SDK tem mecanismo próprio de arquivos ⚠️ | Investigar na Fase 4 |
| Provedor de e-mail | Verificação e recuperação de senha | **Decisão sua** (SMTP próprio, Resend ou SES) |
| Hospedagem | Fly.io vs. Railway vs. VPS | **Decisão sua**; recomendo Fly.io |
| Dados do controlador (LGPD) | Razão social, CNPJ, e-mail do encarregado nos termos | **Decisão sua** (modelos com placeholders) |

---

## 16. Roadmap pós-v1

Posicionamento livre de elementos; formas e setas; exportar PPTX e PDF nativo no servidor; banco de imagens (Unsplash/Pexels, com chave do operador); colaboração multiusuário com cursores; comentários; marca/tema da empresa (upload de logo e cores); templates de apresentação; vídeo e GIF; gravação de ensaio com tempos por slide; analytics de apresentação compartilhada; publicação web com link público.

---

## 17. O que mudou na implementação (Fase 1)

- **Escopo npm provisório `@slideia/*`** até a definição do nome.
- **`@slideia/core/browser`**: entrada sem Zod para bundles de navegador; as constantes do schema
  foram para `constants.ts`. O player embutido no HTML tem ~58 KB (20 KB gzip).
- **Operações**: além das previstas, `reorder_elements`, `duplicate_slide`, `move_slide` e
  `replace_slide` (tabela do §4 atualizada). `slide` aceita id ou número (base 1).
- **Markdown estendido**: uma linha = um parágrafo; linhas em branco são só separadores; `{}` é
  um parágrafo vazio; `\` no fim da linha é quebra dentro do parágrafo; trechos que gerariam
  delimitadores ambíguos são serializados como span (`[texto]{b i u}`). Verificado com 200 mil
  casos aleatórios.
- **Autofit** tolera ~0,3em de "estouro" causado pelas métricas da fonte em entrelinhas apertadas
  (não é estouro real).
- **KPIs no mesmo slot** compartilham o tamanho da fonte, calculado pelo valor mais longo
  (container queries).
- **Corte de imagem** (`crop`) usa `object-view-box` (Chrome/Edge); nos demais navegadores a
  imagem aparece sem corte, respeitando o ponto focal. Implementação completa com o editor (Fase 2).
- **Fontes** embutidas só no subconjunto latino (cobre o português). Idiomas com outros alfabetos
  caem na fonte do sistema — roadmap: subset por caracteres usados.
- **Imagens de exemplo** são geradas localmente (`scripts/gen-example-assets.ts`), sem fotos de
  terceiros no repositório.


## 18. O que mudou na implementação (Fase 2)

- **SQLite via `node:sqlite`** (embutido no Node 24, sem dependência nativa) com SQL direto em
  `server/src/store.ts`, no lugar do Kysely. Uma coluna `owner` já separa os dados por usuário;
  a camada de Postgres entra na Fase 3 com a mesma interface.
- **Vários processos locais**: o primeiro abre o editor na porta 47800; os demais reaproveitam e
  assumem se ele cair. O token de sessão fica em `~/Apresentacoes/.apresenta/token` (0600). O SSE
  consulta a versão no banco a cada 1,2 s para enxergar gravações de outros processos.
- **Schemas das tools compactos** (< 16 KB no total, testado): estrutura essencial + `get_guide`.
  O servidor revalida tudo com o schema completo e responde com caminho do campo e correção.
- **Imagens por URL que falham** viram um placeholder e uma nota no resultado, para que um link
  quebrado não derrube a criação inteira.
- **Imagens servidas em `/media/:id`**; o corte usa posicionamento absoluto (funciona em todos os
  navegadores) e o editor trava o corte na proporção do quadro.
- **`DesignWarning.pt`**: avisos em português para o editor (o `message` em inglês segue para a IA).
- **Editor**: TipTap montado dentro do próprio `.rt` do slide renderizado; marcas customizadas
  (`textColor`, `hl`, atributos de parágrafo) geram exatamente a marcação do renderer.
- **Bundle local** (`packages/server/dist/stdio.js`, ~3 MB + editor/fontes/player/exemplos):
  `sharp` e `playwright-core` ficam como dependências externas. O pacote npm publicável
  (`npx [pacote]`) e o `.mcpb` ficam para a Fase 4.

## 19. O que mudou na implementação (Fase 3)

- **Servidor OAuth 2.1 próprio** (`server/src/remote/oauth.ts`, só `node:crypto`), no lugar do
  Better Auth: controle exato de DCR, CIMD, PKCE, RFC 8707/9207 e rotação de refresh tokens.
  Interoperabilidade verificada com o **cliente OAuth oficial do SDK MCP** (testes automatizados).
- **Senhas com scrypt** (`node:crypto`), em vez de argon2id (sem dependência nativa).
- **Repositório assíncrono único** (`PresentationRepo`) com duas implementações: SQLite (local) e
  Postgres (remoto, `pg` ou **PGlite** embutido). Escritas concorrentes: mutex + `BEGIN IMMEDIATE`
  (SQLite) e `SELECT … FOR UPDATE` (Postgres). O serviço é criado por usuário (escopo `owner`).
- **Imagens**: interface `BlobStore` (disco ou S3 via `@aws-sdk/client-s3`); na simulação Docker,
  **SeaweedFS** (as imagens da MinIO deixaram de ser publicadas no Docker Hub).
- **E-mail**: `console` (dev), `smtp` (nodemailer; Mailpit na simulação) ou `resend`.
- **MCP remoto stateless**, `enableJsonResponse`; escopo `presentations:write` exigido nas tools
  de escrita; `render` remoto devolve link assinado em vez de gravar arquivo.
- **Links do chat** (download/apresentar) são URLs assinadas com HMAC e validade de 24 h; o link do
  editor exige login na mesma conta.
- **Rate limiting em memória** (instância única) — trocar por armazenamento compartilhado ao escalar.
- **Páginas públicas** com texto provisório (Fase 4 traz as versões completas).

## 20. O que mudou na implementação (Fase 4 — widget no chat)

- **MCP Apps (SEP-1865, spec 2026-01-26)**, suportado por Claude e ChatGPT: resource
  `ui://slideia/viewer-v1.html` (`text/html;profile=mcp-app`), ligado a `create_presentation`,
  `apply_edits` e `open_editor` por `_meta.ui.resourceUri` (+ alias `openai/outputTemplate` e
  textos `openai/toolInvocation/*`). Mudou o HTML de forma incompatível → nova versão no URI
  (os hosts usam o URI como chave de cache).
- **Bundle em `packages/renderer/src/widget`** (não no editor): ponte JSON-RPC própria
  (`ui/initialize` → `ui/notifications/initialized` → `tool-result`; `ui/open-link`,
  `ui/request-display-mode`, `ui/notifications/size-changed`), sem dependências, ~54 KB.
  Usa o mesmo `renderSlide`/`deckCss`/`autofit` do player; slides inativos com
  `visibility:hidden` para o autofit medir todos.
- **Dados no `_meta["slideia/view"]` do resultado** (vão só para o widget, não para o modelo):
  a apresentação com imagens trocadas por URLs, `@font-face` com URLs e os ícones usados.
- **CSP**: `resourceDomains` = origem do servidor; nada de `connect`. Fontes em `GET /fonts/:file`
  (públicas, CORS `*`); imagens em `GET /m/:id` com HMAC por dono+imagem, validade 30 dias
  (o widget fica no histórico). No modo local (sem links assinados) as imagens vão inline.
- Fallback para o Apps SDK legado: `window.openai.toolResponseMetadata` e `openExternal`.

## 21. SDK do MCP v2 (protocolo 2026-07-28)

- O servidor usa `@modelcontextprotocol/server` 2.x (antes `@modelcontextprotocol/sdk` 1.x, que só ia
  até 2025-11-25: Claude e ChatGPT tentavam 2026-07-28, recebiam 400 e recuavam).
- Remoto: um único `createMcpHandler(factory, { responseMode: "json" })` montado com
  `toNodeHandler` (`@modelcontextprotocol/node`). Atende clientes 2026-07-28 e, sem estado, os da era
  2025 (handshake `initialize`). A autenticação continua nossa (`mcpAccess`): o resultado vai em
  `req.auth` (`extra.userId`) e chega à fábrica como `authInfo`.
- Local: `StdioServerTransport` de `@modelcontextprotocol/server/stdio`.
- O SDK v2 ainda gera `$schema`, `propertyNames`, `additionalProperties: {}` e ±MAX_SAFE_INTEGER:
  `portableToolSchemas` (Gemini) continua necessário e funciona pelo mesmo `_requestHandlers`.
- Testes: `server.test.ts` usa o cliente v2 em memória; `remote.test.ts` mantém o cliente v1 pela
  rede (prova a compatibilidade 2025) e tem um teste com o cliente v2 fixado em 2026-07-28.
- Pendente: `subscriptions/listen` + `handler.notify` permitiriam avisar clientes 2026 quando a lista
  de ferramentas muda (evitaria reconectar).

