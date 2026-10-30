#!/usr/bin/env bash
# Prepara e executa o projeto para teste.
#
#   ./iniciar.sh --editor        abre o editor visual (com apresentações de exemplo na 1ª vez)
#   ./iniciar.sh --mcp           compila o servidor MCP e mostra como conectá-lo à sua IA
#   ./iniciar.sh --remoto        simula o servidor remoto (login, OAuth, MCP por HTTP) sem Docker
#   ./iniciar.sh --docker        pilha completa no Docker: Postgres + S3 + caixa de e-mail
#   ./iniciar.sh                 gera as apresentações de exemplo em HTML e abre no navegador
#   ./iniciar.sh meu.json        gera e abre o HTML de uma apresentação sua (--assets pasta)
#   ./iniciar.sh --testes        roda typecheck, lint, testes unitários e e2e antes
#   ./iniciar.sh --sem-abrir     não abre o navegador
#
# Variáveis: APRESENTA_HOME (pasta das apresentações, padrão ~/Apresentacoes),
#            APRESENTA_PORT (porta do editor, padrão 47800).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MODE="exemplos"
RUN_TESTS=0
OPEN=1
INPUT=""
ASSETS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --editor) MODE="editor" ;;
    --mcp) MODE="mcp" ;;
    --testes) RUN_TESTS=1 ;;
    --sem-abrir) OPEN=0 ;;
    --assets) shift; ASSETS="${1:-}" ;;
    --remoto) MODE="remoto" ;;
    --docker) MODE="docker" ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) INPUT="$1" ;;
  esac
  shift
done

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mErro: %s\033[0m\n' "$1" >&2; exit 1; }

open_url() {
  [[ "$OPEN" -eq 1 ]] || return 0
  if command -v xdg-open >/dev/null; then xdg-open "$1" >/dev/null 2>&1 &
  elif command -v open >/dev/null; then open "$1"
  elif command -v wslview >/dev/null; then wslview "$1"
  else echo "(abra o endereço acima no navegador)"
  fi
}

# --- Node.js e pnpm ------------------------------------------------------------
step "Verificando o Node.js"
command -v node >/dev/null || fail "Node.js não encontrado. Instale a versão 24 ou superior (https://nodejs.org)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 24 ]] || fail "Node.js $(node -v) encontrado; é preciso a versão 24 ou superior."
echo "Node.js $(node -v)"

step "Verificando o pnpm"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null && command -v corepack >/dev/null; then
  mkdir -p "$HOME/.local/bin"
  corepack enable --install-directory "$HOME/.local/bin" 2>/dev/null || corepack enable
  export PATH="$HOME/.local/bin:$PATH"
fi
command -v pnpm >/dev/null || fail "pnpm não encontrado. Rode: npm install -g pnpm"
echo "pnpm $(pnpm -v)"

if [[ ! -d node_modules || package.json -nt node_modules || pnpm-lock.yaml -nt node_modules ]]; then
  step "Instalando dependências"
  pnpm install
  touch node_modules
fi

# --- Testes (opcional) ---------------------------------------------------------
if [[ "$RUN_TESTS" -eq 1 ]]; then
  step "Typecheck";        pnpm -s typecheck
  step "Lint";             pnpm -s lint
  step "Testes unitários"; pnpm -s test
  step "Testes e2e (Playwright + Google Chrome)"
  if command -v google-chrome >/dev/null || command -v google-chrome-stable >/dev/null; then
    pnpm -s test:e2e
  else
    echo "Google Chrome não encontrado; pulando e2e (ou instale com: npx playwright install chromium)."
  fi
fi

SERVER="$ROOT/packages/server/dist/stdio.js"

build_server() {
  # Recompila quando o bundle não existe ou algum fonte é mais novo.
  if [[ ! -f "$SERVER" ]] || [[ -n "$(find packages/*/src packages/editor/index.html assets/examples -newer "$SERVER" -type f -print -quit 2>/dev/null)" ]]; then
    step "Compilando o servidor e o editor"
    pnpm -s --filter @apresenta/server build
  fi
}

case "$MODE" in
  editor)
    build_server
    step "Iniciando o editor (Ctrl+C para encerrar)"
    LOG="$(mktemp)"
    node "$SERVER" --editor --seed-examples 2> >(tee "$LOG" >&2) &
    PID=$!
    trap 'kill $PID 2>/dev/null' EXIT INT TERM
    for _ in $(seq 1 60); do
      LINK="$(grep -o 'http://[^ ]*' "$LOG" | head -1 || true)"
      [[ -n "$LINK" ]] && break
      sleep 0.5
    done
    [[ -n "${LINK:-}" ]] || fail "O editor não iniciou (veja a mensagem acima)."
    echo
    echo "Editor: $LINK"
    open_url "$LINK"
    wait $PID
    ;;

  mcp)
    build_server
    HOME_DIR="${APRESENTA_HOME:-$HOME/Apresentacoes}"
    step "Servidor MCP pronto"
    cat <<EOF

Arquivo do servidor: $SERVER
Pasta das apresentações: $HOME_DIR

Claude Code (terminal):
  claude mcp add apresenta -- node "$SERVER"
  Depois, em uma nova sessão: "crie uma apresentação de 10 slides sobre ..."

Claude Desktop (Configurações → Desenvolvedor → Editar configuração), Cursor ou VS Code:
  {
    "mcpServers": {
      "apresenta": { "command": "node", "args": ["$SERVER"] }
    }
  }

Gemini CLI (~/.gemini/settings.json):
  {
    "mcpServers": {
      "apresenta": { "command": "node", "args": ["$SERVER"] }
    }
  }

A IA devolve o link do editor (http://127.0.0.1:${APRESENTA_PORT:-47800}/...) e o link para baixar o HTML.
Para testar sem IA: ./iniciar.sh --editor
EOF
    ;;

  remoto)
    build_server
    REMOTE_PORT="${PORT:-8787}"
    export APRESENTA_DEV=1 PORT="$REMOTE_PORT" HOST=127.0.0.1
    export PUBLIC_URL="${PUBLIC_URL:-http://localhost:$REMOTE_PORT}"
    export DATA_DIR="${DATA_DIR:-$ROOT/data/remoto}"
    export DATABASE_URL="${DATABASE_URL:-pglite:$DATA_DIR/pg}"
    export DEMO_EMAIL="${DEMO_EMAIL:-demo@apresenta.local}" DEMO_PASSWORD="${DEMO_PASSWORD:-demo-apresenta-2026}"
    step "Servidor remoto simulado (Ctrl+C para encerrar)"
    cat <<INFO

Endereço:   $PUBLIC_URL
MCP:        $PUBLIC_URL/mcp   (OAuth 2.1)
Conta demo: $DEMO_EMAIL / $DEMO_PASSWORD
E-mails de verificação aparecem no terminal e, em modo dev, na própria tela.
Dados em:   $DATA_DIR  (Postgres embutido — PGlite)

MCP Inspector:  npx @modelcontextprotocol/inspector  → "Streamable HTTP", URL $PUBLIC_URL/mcp
ChatGPT:        exponha por HTTPS (ex.: cloudflared tunnel --url $PUBLIC_URL) — veja docs/REMOTO.md

INFO
    (sleep 4; open_url "$PUBLIC_URL/entrar") &
    exec node "$ROOT/packages/server/dist/remote.js"
    ;;

  docker)
    command -v docker >/dev/null || fail "Docker não encontrado."
    step "Subindo Postgres, S3 (SeaweedFS), caixa de e-mail (Mailpit) e o servidor"
    docker compose up -d --build
    step "Pronto"
    cat <<INFO

Endereço:   http://localhost:8787   (conta demo: demo@apresenta.local / demo-apresenta-2026)
MCP:        http://localhost:8787/mcp
E-mails:    http://localhost:8025   (Mailpit: verificação de conta, recuperação de senha)
Logs:       docker compose logs -f app
Encerrar:   docker compose down        (os dados ficam nos volumes; "down -v" apaga)
INFO
    open_url "http://localhost:8787/entrar"
    ;;

  exemplos)
    mkdir -p out
    if [[ -n "$INPUT" ]]; then
      [[ -f "$INPUT" ]] || fail "Arquivo não encontrado: $INPUT"
      step "Gerando o HTML de $INPUT"
      TARGET="$ROOT/out/$(basename "${INPUT%.*}").html"
      ARGS=("$INPUT" -o "$TARGET")
      [[ -n "$ASSETS" ]] && ARGS+=(--assets "$ASSETS")
      pnpm -s render "${ARGS[@]}"
    else
      step "Gerando as apresentações de exemplo"
      pnpm -s examples
      TARGET="$ROOT/out/index.html"
      {
        cat <<'HTML'
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Apresentações de exemplo</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1f2933;background:#f7f8fa}
h1{font-size:26px}a.card{display:block;padding:16px 20px;margin:10px 0;background:#fff;border-radius:12px;border:1px solid #dde2e8;color:inherit;text-decoration:none}
a.card:hover{border-color:#1d4ed8}a.card b{color:#1d4ed8;font-size:18px}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:12px}td{padding:6px 12px;border-bottom:1px solid #eef0f3}
kbd{font:13px ui-monospace,monospace;background:#eef0f3;border-radius:5px;padding:2px 6px}
</style></head><body>
<h1>Apresentações de exemplo</h1>
<p>Cada arquivo é um HTML único que funciona offline. Para editar visualmente, rode <code>./iniciar.sh --editor</code>.</p>
HTML
        for f in out/examples/*.html; do
          title="$(grep -o '<title>[^<]*</title>' "$f" | sed 's/<[^>]*>//g')"
          size="$(( $(wc -c < "$f") / 1024 ))"
          echo "<a class=\"card\" href=\"examples/$(basename "$f")\"><b>$title</b><br><small>examples/$(basename "$f") · ${size} KB</small></a>"
        done
        cat <<'HTML'
<h2>Teclas</h2>
<table>
<tr><td><kbd>→</kbd> <kbd>PageDown</kbd> <kbd>Espaço</kbd> clique</td><td>avançar</td></tr>
<tr><td><kbd>←</kbd> <kbd>PageUp</kbd> <kbd>Backspace</kbd></td><td>voltar</td></tr>
<tr><td><kbd>F5</kbd> / <kbd>Shift+F5</kbd></td><td>tela cheia do início / do slide atual</td></tr>
<tr><td>número + <kbd>Enter</kbd></td><td>ir para o slide</td></tr>
<tr><td><kbd>B</kbd> / <kbd>W</kbd></td><td>tela preta / branca</td></tr>
<tr><td><kbd>S</kbd></td><td>visão do apresentador (permita pop-ups)</td></tr>
<tr><td><kbd>T</kbd></td><td>teste e configuração do passador</td></tr>
<tr><td><kbd>E</kbd></td><td>edição rápida dos textos</td></tr>
<tr><td><kbd>Ctrl+P</kbd></td><td>imprimir / PDF</td></tr>
</table>
</body></html>
HTML
      } > "$TARGET"
    fi
    step "Pronto"
    echo "Abra: file://$TARGET"
    open_url "$TARGET"
    ;;
esac
