# [NOME] — apresentações em HTML criadas com IA

Ferramenta para criar, editar e apresentar slides em HTML com transições no estilo PowerPoint.
A IA do usuário (Claude, ChatGPT, Gemini CLI) monta a apresentação via MCP; o usuário ajusta
textos e detalhes num editor visual; o resultado é um único arquivo `.html` que funciona offline
e com passador.

> Fases 1 a 3 de 4 concluídas: renderer/player, servidor MCP local, editor e servidor remoto com
> login e OAuth (pronto para ChatGPT/Claude via HTTPS). Arquitetura:
> [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) · modo remoto: [`docs/REMOTO.md`](docs/REMOTO.md).

## Requisitos

- Node.js 24+
- pnpm (o `iniciar.sh` ativa via corepack)
- Google Chrome (para o `preview` da IA e os testes e2e; ou `npx playwright install chromium`)

## Começando

```bash
./iniciar.sh --editor   # abre o editor no navegador, com 3 apresentações de exemplo
./iniciar.sh --mcp      # mostra como conectar o servidor à sua IA
./iniciar.sh            # só gera os HTMLs de exemplo (out/examples)
./iniciar.sh --remoto   # servidor remoto simulado: login, OAuth, MCP por HTTP (sem Docker)
./iniciar.sh --docker   # pilha completa: Postgres + S3 + caixa de e-mail (Mailpit)
./iniciar.sh --testes   # roda todos os testes antes
```

As apresentações ficam em `~/Apresentacoes` (mude com `APRESENTA_HOME`). O editor roda em
`http://127.0.0.1:47800` (mude com `APRESENTA_PORT`) e só aceita quem tem o link com a chave.

## Usando com a sua IA (modo local)

```bash
./iniciar.sh --mcp
claude mcp add apresenta -- node "$PWD/packages/server/dist/stdio.js"   # Claude Code
```

Em uma nova sessão do Claude Code, peça por exemplo: *"crie uma apresentação de 10 slides sobre
o plano de marketing 2027 e me mande o link do editor"*. A IA chama `get_guide`, cria a
apresentação, confere com `preview` e devolve:

- **link do editor** — clique em qualquer texto para editar; a IA vê suas alterações;
- **link de download** — o `.html` final (também salvo em `~/Apresentacoes`).

Claude Desktop, Cursor, VS Code e Gemini CLI usam a mesma configuração (`./iniciar.sh --mcp`
imprime os trechos prontos). Para o Claude Code ensinar o fluxo ideal à IA, copie
`skills/apresentacoes` para `~/.claude/skills/`.

### Tools MCP

| Tool | O que faz |
|------|-----------|
| `get_guide` | formato, layouts, temas, transições e regras de design |
| `create_presentation` | cria a partir de JSON (textos em Markdown); devolve links e avisos |
| `get_presentation` | lê a versão atual (`outline` com ids, ou `full`) |
| `list_presentations` | lista as apresentações |
| `apply_edits` | várias edições em uma chamada, com controle de versão e mescla |
| `add_image` | guarda imagem de URL ou base64 (redimensiona e comprime) |
| `get_changes` | descreve o que o usuário mudou no editor |
| `preview` | imagem dos slides (como serão apresentados) + textos que não cabem |
| `render` | gera o `.html` autocontido |
| `open_editor` | link do editor e de apresentação |

Também há os prompts `criar_apresentacao` e `apresentacao_a_partir_de_documento`, e resources com
o JSON Schema, o guia de design e exemplos.

## Modo remoto (ChatGPT, Claude web)

`./iniciar.sh --remoto` sobe o servidor em `http://localhost:8787` com conta demo
(`demo@apresenta.local` / `demo-apresenta-2026`). O endpoint MCP `…/mcp` usa OAuth 2.1 (DCR, CIMD,
PKCE): conecte pelo MCP Inspector, ou exponha por HTTPS (túnel) e adicione como conector no
ChatGPT em modo desenvolvedor ou no Claude. Passo a passo e deploy: [`docs/REMOTO.md`](docs/REMOTO.md).

## Editor

- Clique no texto do slide para editar no lugar; barra flutuante com negrito, itálico, sublinhado,
  cor, destaque, link (Ctrl+K), alinhamento, listas (Tab/Shift+Tab), tamanho e limpar formatação.
- Miniaturas com arrastar e soltar, duplicar, ocultar e excluir; “+ Novo slide” com os 13 layouts.
- Painel de propriedades: layout, fundo, transição (com teste), animações, dados de gráficos,
  tabelas, ícones, KPIs, linha do tempo, tema, cores e fontes.
- Imagens: envio, arrastar e soltar, URL, corte e posicionamento.
- Modo **Roteiro**: todos os textos e anotações em sequência, como um documento.
- Desfazer/refazer, localizar e substituir, histórico de versões (“Você” / “IA”) com restauração.
- Salvamento automático; alterações da IA aparecem em tempo real e destacadas.
- Apresentar (F5), Baixar HTML, Imprimir/PDF, Exportar JSON.

## Apresentando

| Tecla | Ação |
|-------|------|
| → ↓ PageDown Espaço Enter, clique | avançar (revela passos de animação antes de trocar de slide) |
| ← ↑ PageUp Backspace | voltar |
| F5 / Shift+F5 | tela cheia do início / do slide atual |
| número + Enter | ir para o slide |
| B ou . / W ou , | tela preta / branca |
| S | visão do apresentador (segunda janela: atual, próximo, anotações, cronômetro, relógio) |
| T | teste do passador: mostra `key`/`code` recebidos e permite mapear botões |
| E | edição rápida dos textos no próprio HTML; “Salvar HTML” grava um novo arquivo |
| ? | atalhos |

## Estrutura

```
packages/core       schema, Markdown ⇄ texto rico, layouts, temas, operações, diff, regras de design
packages/renderer   JSON → HTML, CSS, player, export autocontido, CLI
packages/server     MCP (stdio), API do editor, SQLite, imagens, preview
packages/editor     editor visual (React + TipTap)
assets/examples     apresentações de exemplo (JSON no formato da IA) e imagens
skills/             skill do Claude Code com o fluxo ideal
e2e                 testes Playwright (player e editor + MCP)
```

## Testes

```bash
pnpm test        # unitários: schema, Markdown (propriedade), operações, diff, design, temas,
                 # XSS, export/CSP, tools MCP, conflitos, SSRF, API HTTP
pnpm test:e2e    # player (passador, apresentador, edição rápida, impressão) e o fluxo completo:
                 # cliente MCP cria 10 slides → edição no editor → edição da IA ao vivo → download
pnpm typecheck && pnpm lint
```

Para inspecionar o servidor: `npx @modelcontextprotocol/inspector node packages/server/dist/stdio.js`.
