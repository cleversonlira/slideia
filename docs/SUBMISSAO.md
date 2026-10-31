# Submissão aos diretórios (ChatGPT e Claude)

Material pronto para colar nos formulários do diretório de apps do ChatGPT (OpenAI) e do diretório
de conectores do Claude (Anthropic). Os formulários são em inglês; os textos abaixo também.
Revise nomes, e-mail e links antes de enviar.

## O que só o responsável pode fazer

1. **OpenAI:** conta de desenvolvedor verificada (pessoa física é aceita) e início da submissão no
   painel de apps. O formulário pede um token de verificação do domínio: coloque-o no `.env` da VPS
   como `OPENAI_APPS_CHALLENGE_TOKEN=<token>` e rode o deploy. O servidor já responde em
   `https://slideia.site/.well-known/openai-apps-challenge`.
2. **Anthropic:** formulário do diretório de conectores remotos do Claude.
3. **Conta de demonstração para os revisores:** já existe (`demo@slideia.site`). A senha fica só no
   servidor: `ssh root@46.202.88.184 "grep ^DEMO_PASSWORD /opt/slideia/.env"`. Ela foi criada uma
   vez, já verificada e com as apresentações de exemplo; o que os revisores fizerem fica nela.
4. **Vídeo de demonstração** (roteiro abaixo), gravado no ChatGPT e no Claude.
5. **Revisão jurídica** das páginas `/privacidade` e `/termos` (recomendada antes de divulgar).

## Ficha do app

| Campo | Valor |
| --- | --- |
| Name | SlideIA |
| MCP server URL | `https://slideia.site/mcp` |
| Auth | OAuth 2.1 (authorization code + PKCE; CIMD and dynamic client registration) |
| Website | https://slideia.site |
| Privacy policy | https://slideia.site/privacidade |
| Terms of use | https://slideia.site/termos |
| Support | https://slideia.site/suporte · suporte@slideia.site |
| Icon | https://slideia.site/icon-512.png (512×512 PNG) |
| Category | Productivity |
| Pricing | Free |
| Developer | Cleverson Lira (individual), Niterói/RJ, Brazil |

**Short description (≤ 80 chars)**

> Create, edit and present slide decks with AI, then fine-tune them in a visual editor.

**Long description**

> SlideIA turns a conversation into a finished presentation. Ask for a deck on any topic and the
> assistant builds it with real layouts, a consistent theme, charts, tables, icons and images, and
> shows it right in the chat. Open the visual editor to change any text by hand, reorder slides or
> swap images; the assistant sees your edits and never overwrites them. Apply your company brand
> (colors, cover color and logo) once and every slide follows it. Present from the browser with
> presenter view and keyboard shortcuts, download an editable PowerPoint file, or a single offline HTML file that works
> anywhere. Your presentations are private to your account, and you can delete your account and all
> its data at any time.

**What the user can do (bullets)**

- Create a complete deck from a prompt (8–15 slides, layouts, charts, tables, images)
- See the slides in the chat and open them in the visual editor
- Ask for edits in plain language; manual edits are preserved
- Apply brand colors and a logo to every slide
- Present in the browser, or download an editable PowerPoint (.pptx) or a standalone HTML file

## Ferramentas e anotações

Justificativa das anotações, caso o revisor pergunte:

| Tool | readOnly | destructive | Por quê |
| --- | --- | --- | --- |
| `get_guide` | sim | não | Só devolve a documentação do formato. |
| `create_presentation` | não | não | Cria uma apresentação nova; não altera nada existente. |
| `get_presentation`, `list_presentations`, `get_changes` | sim | não | Leitura das apresentações do próprio usuário. |
| `apply_edits` | não | **sim** | Pode remover slides e elementos (há histórico de versões para desfazer). |
| `add_image` | não | não | Guarda uma imagem nova na conta do usuário. |
| `preview` | sim | não | Gera uma imagem dos slides. |
| `render` | sim (remoto) | não | Devolve o link do HTML; no remoto não grava arquivos. |
| `open_editor` | sim | não | Devolve links. |

Nenhuma ferramenta acessa serviços de terceiros em nome do usuário. A única saída para a internet é
baixar imagens de URLs públicas que a IA ou o usuário indicam, com proteção contra SSRF.

## Instruções para os revisores (colar no formulário)

> 1. Add the MCP server `https://slideia.site/mcp` and sign in with the demo account
>    (email: demo@slideia.site, password: <DEMO_PASSWORD>). You can also create your own account;
>    e-mail verification is required.
> 2. Approve the consent screen ("SlideIA wants to access your presentations").
> 3. Run the test prompts below. Each created deck appears as an inline carousel; the "Open in
>    editor" button opens the visual editor (already signed in through the same account).
> 4. The demo account starts with three sample presentations; feel free to create, edit and delete.

## Casos de teste

Positivos (devem chamar as tools e mostrar o carrossel):

1. "Create a 10-slide presentation about the benefits of remote work for a board meeting." →
   `get_guide`, `create_presentation` (+ `preview`); widget com 10 slides e links.
2. "Make slide 3 a two-column comparison and change the theme to dark." → `get_presentation`,
   `apply_edits`; widget atualizado.
3. "Use our brand: main color #0057b8, cover color #00263e, logo https://slideia.site/icon-512.png."
   → `apply_edits` com `update_presentation.themeOverrides`; logo no canto dos slides.
4. "Add a bar chart with quarterly revenue: Q1 12, Q2 15, Q3 18, Q4 21 (R$ millions)." →
   `apply_edits` com `add_slide`/`add_element` do tipo chart.
5. "List my presentations and open the last one in the editor." → `list_presentations`,
   `open_editor`.
6. "Give me this deck as PowerPoint." → `render`; `pptxUrl` baixa um .pptx editável (e
   `downloadUrl`, o HTML offline).

Negativos (não devem chamar as tools de escrita):

1. "What is the capital of France?" → resposta direta, sem tools.
2. "Summarize this paragraph: …" → resposta direta.
3. "Delete all my presentations." → não existe tool para isso; a IA deve explicar que a exclusão é
   feita pelo usuário na página da conta (`/conta`).

## Roteiro do vídeo (2–3 min)

1. (0:00) Tela do ChatGPT com o SlideIA conectado. Pedido: "Crie uma apresentação de 8 slides sobre
   o lançamento do nosso app de finanças pessoais".
2. (0:30) O carrossel aparece no chat; navegar por 3 ou 4 slides.
3. (0:50) "Use as cores da marca #0057b8 e capa #00263e" → carrossel atualizado.
4. (1:10) Abrir no editor: editar um título à mão, trocar uma imagem, enviar o logo em
   Apresentação → Marca.
5. (1:40) De volta ao chat: "Adicione um slide de próximos passos". A IA lê a versão editada e
   preserva a edição manual.
6. (2:00) Apresentar no navegador (tela cheia, visão do apresentador) e baixar o HTML.
7. (2:20) Repetir rapidamente no Claude para mostrar que o mesmo servidor atende os dois.

## Pendências técnicas ligadas à submissão

- **Domínio do widget no ChatGPT** (`_meta.ui.domain`): só definir quando o formulário disser o
  formato exigido. Hoje o widget funciona sem ele no modo desenvolvedor.
- **CSP do widget:** `resourceDomains` = `https://slideia.site` (fontes e imagens assinadas);
  `connectDomains` vazio.
