# Prompt — Ferramenta de criação de apresentações HTML com IA (MCP)

> Substitua `[NOME]` pelo nome da ferramenta quando definido.

```
Você é um arquiteto de software sênior especialista no Model Context Protocol (MCP), em OAuth 2.1, em editores de texto rico para web e em animações web. Desenvolva a ferramenta [NOME]: uma ferramenta especializada em CRIAR, EDITAR E APRESENTAR APRESENTAÇÕES EM HTML, com transições no estilo PowerPoint, composta por um SERVIDOR MCP (usado dentro do ChatGPT, Claude e Gemini CLI) e um EDITOR VISUAL web.

# 1. Conceito central
- A ferramenta NÃO chama nenhuma API de IA e NÃO usa chaves de API. Toda a inteligência vem da IA do usuário (o host MCP: ChatGPT, Claude etc.), consumindo a assinatura dele.
- Fluxo do usuário: conversa com a IA no ChatGPT/Claude → a IA cria a apresentação chamando as tools do [NOME] → o usuário recebe o link do editor → ajusta textos e detalhes manualmente → pode pedir mais alterações à IA → apresenta ou baixa o HTML.
- A IA não escreve HTML livre: envia JSON no "Presentation Schema", validado com Zod. Erros retornam mensagens claras (caminho do campo + como corrigir) para a IA se autocorrigir.
- IA e editor alteram a MESMA apresentação armazenada no servidor (fonte única da verdade).
- Público-alvo principal: usuários do ChatGPT, via app publicado no diretório de apps do ChatGPT. Secundário: Claude (conector personalizado remoto, Claude Desktop e Claude Code) e Gemini CLI.

# 2. Arquitetura (monorepo TypeScript, pnpm workspaces)
packages/
- core/        → Presentation Schema, validação, temas, layouts, regras de design, operações de edição (patches), conversão Markdown ↔ texto rico
- renderer/    → JSON → HTML autocontido (player + transições). Componentes de renderização compartilhados com o editor.
- editor/      → aplicação web de edição (React + Vite + TipTap)
- server/      → servidor MCP (SDK oficial TypeScript) em HTTP streamable + stdio; OAuth 2.1; API REST interna do editor; páginas públicas; armazenamento
- site/        → landing page, como conectar, suporte, política de privacidade e termos de uso
Infra: Postgres (ou SQLite no modo local), armazenamento de arquivos em disco ou S3 compatível, Dockerfile, docker-compose e instruções de deploy (Fly.io, Railway ou VPS).

# 3. Presentation Schema (core)
- Metadados: título, autor, idioma, proporção (16:9 / 4:3), tema, `version` (inteiro, incrementado a cada alteração).
- Slide: id estável, layout, elementos, fundo, transição (tipo + duração), anotações do apresentador.
- Layouts: capa, seção, título+conteúdo, duas colunas, imagem cheia, imagem+texto, citação, números/KPIs, linha do tempo, comparação, gráfico, tabela, encerramento.
- Elementos (todos com id estável): título, texto, lista, imagem, ícone (Lucide), gráfico (barras/linhas/pizza em SVG), tabela, citação.
- TEXTO RICO RESTRITO: formato estruturado (parágrafos → trechos com marcas), nunca HTML. Marcas: negrito, itálico, sublinhado, tachado, cor (cores do tema + personalizada), destaque, link, sobrescrito/subscrito. Parágrafo: alinhamento, lista (marcadores/numerada, até 3 níveis), tamanho (escala do tema: pequeno, normal, grande, destaque).
- Para a IA, aceitar também Markdown leve (**negrito**, *itálico*, listas, links), convertido pelo servidor para o formato estruturado (economiza tokens).
- Transições: none, fade, slide (4 direções), push, zoom, dissolve, flip3d, cube3d, reveal + efeito Ken Burns em imagens.
- Animações de entrada de elementos (passo a passo, a cada "avançar").
- Temas: no mínimo 8 temas profissionais (paleta, tipografia, espaçamento), com fontes embutíveis e contraste acessível (WCAG AA).
- Schema enxuto e bem descrito (description em todos os campos), pois a IA o lê. Exportar também como JSON Schema.

# 4. Servidor MCP (server)
## Tools
- `get_guide` (leitura) → schema compacto, layouts, temas, transições e REGRAS DE DESIGN: um slide = uma ideia; máx. ~6 itens por lista; frases curtas; variar layouts; uma transição padrão consistente e efeitos especiais só em momentos-chave; anotações do apresentador com roteiro de fala. A descrição da tool instrui a IA a chamá-la antes de criar.
- `create_presentation(presentation)` (escrita) → valida, salva, retorna id, versão, avisos de design (ex.: "slide 5 tem texto demais"), link do editor e link de download.
- `get_presentation(id, format: "full" | "outline")` (leitura) → "outline" retorna só os textos.
- `list_presentations()` (leitura).
- `apply_edits(id, expectedVersion, operations[])` (escrita) → aplica VÁRIAS operações em uma única chamada: update_text, update_slide, add_slide, remove_slide, reorder_slides, update_presentation (tema, proporção, transição padrão), find_replace, set_image. Motivo: o ChatGPT pede confirmação do usuário a cada chamada de escrita; agrupar reduz confirmações.
- `add_image(id, source)` (escrita) → URL ou base64, com redimensionamento e compressão.
- `get_changes(id, sinceVersion)` (leitura) → resumo das edições manuais feitas pelo usuário no editor.
- `preview(id, slideNumber?)` (leitura) → PNG do slide (Playwright headless) para a IA conferir o visual (texto estourando, contraste).
- `render(id)` (leitura) → gera o .html autocontido e retorna link de download.
- `open_editor(id, slideNumber?)` (leitura) → retorna o link do editor.
- Todas com inputSchema completo, descrições objetivas e honestas (sem exageros nem instruções que tentem manipular o modelo), e annotations corretas (readOnlyHint, destructiveHint, openWorldHint). Respostas compactas.
- Edições sempre parciais; nunca exigir reenvio da apresentação inteira.

## Prompts e Resources MCP
- Prompts: `criar_apresentacao` (briefing → roteiro para aprovação do usuário → criação → preview → links) e `apresentacao_a_partir_de_documento`.
- Resources: JSON Schema, guia de design, exemplos de apresentações completas.

## Interface no chat (MCP Apps / Apps SDK)
- Componente de UI embutido na conversa (suportado por ChatGPT e Claude) exibindo a apresentação com navegação entre slides, botões "Abrir editor", "Apresentar" e "Baixar HTML". Deve funcionar bem no app mobile do ChatGPT.

## Modos de execução
1. Remoto (principal): HTTP streamable em `https://<domínio>/mcp`, para ChatGPT e Claude web/desktop/mobile.
2. Local (stdio): `npx [pacote]`, com editor em http://127.0.0.1:<porta> (token de sessão na URL) e arquivos em pasta configurável (padrão ~/Apresentacoes). Para Claude Code, Gemini CLI, Cursor e VS Code. Gerar também um pacote .mcpb para instalação com dois cliques no Claude Desktop.

# 5. Autenticação, contas e armazenamento
- OAuth 2.1 conforme a especificação de autorização do MCP: Protected Resource Metadata, Authorization Server Metadata, PKCE, Dynamic Client Registration e Client ID Metadata Document. Sem API key nem headers customizados.
- Cadastro e login próprios (e-mail + senha com verificação de e-mail, e login com Google), telas de login e consentimento em português.
- O mesmo login dá acesso ao editor web.
- Apresentações isoladas por usuário. Links de download com expiração. Exclusão de conta e de dados pelo próprio usuário (LGPD).
- Limites de uso por conta (nº de apresentações, tamanho de imagens) configuráveis, para controlar custos.

# 6. Editor visual (editor)
## Edição de texto direto no slide (WYSIWYG)
- Clique em qualquer texto para editar no lugar, com aparência idêntica à apresentação final.
- TipTap (ProseMirror) restrito às marcas e estruturas do schema. Colar de Word/web limpa formatações não suportadas.
- Barra de formatação flutuante: negrito, itálico, sublinhado, cor, destaque, link, alinhamento, listas, recuo, tamanho, limpar formatação.
- Atalhos: Ctrl+B/I/U/K, Ctrl+Z/Y, Tab/Shift+Tab em listas.
- Autofit (reduz a fonte quando não cabe, com limite mínimo) e aviso visual de texto estourando.
- Spellcheck do navegador no idioma da apresentação.
- Edição de tabelas célula a célula e de títulos/rótulos de gráficos.

## Modo roteiro (outline)
- Todos os textos da apresentação em sequência (título, conteúdo e anotações de cada slide), editáveis como num editor de texto comum. Alterações refletem imediatamente nos slides.

## Demais recursos
- Miniaturas: adicionar, duplicar, excluir e reordenar slides (arrastar e soltar).
- Painel de propriedades: layout, tema, fundo, transição, animações.
- Inserir/trocar imagens (upload, arrastar e soltar, URL), com corte e posicionamento.
- Anotações do apresentador abaixo do slide.
- Localizar e substituir.
- Desfazer/refazer.
- Salvamento automático (debounce ~1 s) com indicador "salvo / salvando / conflito".
- Histórico de versões com restauração, indicando autor da alteração ("você" ou "IA").
- Botões: Apresentar, Baixar HTML, Exportar JSON, Imprimir/PDF.
- Lista "Minhas apresentações".
- Interface em português do Brasil, responsiva (uso básico em tablet e celular).

## Sincronização editor ↔ IA
- Concorrência otimista: toda alteração envia `expectedVersion`; em conflito, o editor avisa e oferece recarregar ou mesclar.
- Alterações feitas pela IA aparecem em tempo real no editor aberto (SSE ou WebSocket), com destaque nos elementos alterados.
- A IA sempre lê o estado mais recente e preserva edições manuais.

# 7. Renderer / Player HTML (renderer)
- ÚNICO arquivo .html autocontido (CSS, JS, fontes e imagens embutidos), funcionando offline em qualquer computador.
- Usa os MESMOS componentes de renderização do editor, garantindo resultado idêntico ao editado.
- Escala automática para qualquer resolução, com letterbox.
- Transições com transform/opacity a 60 fps; pré-carregamento do slide seguinte; respeitar prefers-reduced-motion.
- Controle por teclado e apresentador (passador) Bluetooth/USB, que funciona como teclado:
  - Avançar: PageDown, →, ↓, Espaço, Enter, clique | Voltar: PageUp, ←, ↑, Backspace
  - F5 / Shift+F5: iniciar do começo / do slide atual (com preventDefault para não recarregar a página)
  - B ou ".": tela preta | W: tela branca | Esc: sair | número + Enter: ir para slide
  - Ignorar event.repeat; bloquear comandos durante transições (fila máx. 1).
  - Tela de teste do apresentador (tecla T) mostrando key/code recebidos, com mapeamento de teclas configurável.
- Tela cheia (Fullscreen API); cursor oculto após 2 s parado.
- Visão do apresentador em segunda janela (slide atual, próximo, anotações, cronômetro, relógio), sincronizada via BroadcastChannel; comandos do passador funcionam em qualquer das janelas.
- Impressão/PDF: um slide por página (@media print).
- JSON da apresentação embutido no HTML, permitindo reimportar no editor.
- Edição rápida no HTML exportado (tecla E): textos editáveis, salvando via download de novo .html ou File System Access API.

# 8. Publicação no diretório de apps do ChatGPT (requisito principal)
Desenvolver desde o início para aprovação na revisão da OpenAI:
- Endpoint MCP em HTTPS público e estável.
- Rota de verificação de domínio `/.well-known/openai-apps-challenge` retornando o token em texto puro (token via variável de ambiente).
- OAuth compatível com o fluxo do ChatGPT (registrado, DCR ou CIMD); client secret apenas em variável de ambiente.
- Tools com nomes, descrições e annotations precisos; nenhuma instrução manipulativa nas descrições.
- Páginas públicas obrigatórias: site/landing page, suporte (contato), política de privacidade (LGPD) e termos de uso. Gere modelos dessas páginas.
- Conta demo para revisores: login sem 2FA, com apresentações de exemplo.
- Gerar o material da submissão: descrição do app, 5 casos de teste positivos e 3 negativos (com comportamento esperado), roteiro do vídeo de demonstração, notas da versão.
- Página "Como conectar" com passo a passo para ChatGPT (diretório e modo desenvolvedor), Claude (conector personalizado, Claude Desktop .mcpb, Claude Code) e Gemini CLI.

# 9. Requisitos não funcionais
- TypeScript estrito; ESLint + Prettier.
- Testes unitários (schema, conversão Markdown ↔ texto rico, apply_edits, controle de versão, OAuth) e e2e com Playwright (criar via MCP → editar texto no editor → baixar → apresentar no player com teclas do passador).
- Testar o servidor com o MCP Inspector.
- Segurança: sanitizar todo texto vindo da IA ou colado (sem HTML/JS arbitrário); Content Security Policy no HTML gerado; limite de tamanho de imagens; rate limiting; validação de URLs de imagem (evitar SSRF); dados de cada usuário isolados.
- Observabilidade: logs estruturados e métricas por tool, sem registrar conteúdo das apresentações.
- Sem telemetria de conteúdo. Interface em português do Brasil; apresentações em qualquer idioma.

# 10. Documentação
- README: arquitetura, variáveis de ambiente, rodar localmente, deploy, testes.
- SKILL.md (Claude Code) e AGENTS.md/GEMINI.md ensinando o fluxo ideal: briefing → roteiro → criação → preview → ajustes → links.
- Guia do usuário do editor.
- CLAUDE.md/AGENTS.md na raiz do repositório com decisões e convenções do projeto.

# 11. Fases de entrega
- Fase 1: core + renderer (schema, temas, player com passador). Critério: gerar HTML a partir de um JSON de exemplo e apresentar com o passador Bluetooth.
- Fase 2: server em modo local (stdio) + editor local. Critério: no Claude Code, criar uma apresentação de 10 slides, editar um texto no editor e baixar o HTML.
- Fase 3: server remoto + OAuth + banco + editor com login. Critério: conectar no ChatGPT em modo desenvolvedor e repetir o fluxo.
- Fase 4: UI no chat (MCP Apps), páginas públicas, conta demo, material de submissão, pacote .mcpb.

# Formato da entrega
1. Suposições e decisões de arquitetura (curtas).
2. Presentation Schema completo (incluindo texto rico) primeiro.
3. Código completo, sem trechos omitidos nem "// resto do código aqui", seguindo as fases.
4. Instruções de instalação, testes e integração com cada host.
5. Roadmap.
Entregue em partes numeradas e aguarde meu "continue" entre elas. Ao fim de cada fase, liste como eu testo.
```
