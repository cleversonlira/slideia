#!/bin/bash
# Deploys slideia to the Hostinger VPS (https://slideia.site).
#
#   deploy/vps/deploy.sh            # update: sync code, rebuild the image, restart
#   deploy/vps/deploy.sh --setup    # first time: also nginx site, TLS certificate and backup cron
#   SKIP_CHECKS=1 deploy/vps/deploy.sh   # skip local typecheck/tests
#
# The image is built on the VPS from the synced sources. Secrets are generated on the server
# the first time (/opt/slideia/.env, mode 600) and never leave it.
set -euo pipefail

VPS="${VPS:-root@46.202.88.184}"
DOMAIN="slideia.site"
REMOTE=/opt/slideia
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/deploy/vps"
SETUP=0
[[ "${1:-}" == "--setup" ]] && SETUP=1

info()  { echo "[deploy] $*"; }
error() { echo "[deploy] ERRO: $*" >&2; exit 1; }

if [[ "${SKIP_CHECKS:-0}" != "1" ]]; then
  info "Verificando tipos e testes locais..."
  (cd "$ROOT" && pnpm -s typecheck && pnpm -s test) || error "Typecheck ou testes falharam."
fi

info "Enviando código para $VPS:$REMOTE/src..."
ssh "$VPS" "mkdir -p $REMOTE/src $REMOTE/backups"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude out --exclude data --exclude ppts \
  --exclude test-results --exclude playwright-report --exclude .env --exclude deploy \
  "$ROOT/" "$VPS:$REMOTE/src/"
scp -q "$HERE/docker-compose.yml" "$HERE/backup.sh" "$VPS:$REMOTE/"

info "Preparando configuração e subindo os contêineres (o build leva alguns minutos)..."
ssh "$VPS" DOMAIN="$DOMAIN" REMOTE="$REMOTE" bash -s <<'EOF'
set -euo pipefail
cd "$REMOTE"
chmod +x backup.sh
if [[ ! -f .env ]]; then
  umask 077
  cat > .env <<ENV
PUBLIC_URL=https://$DOMAIN
PRODUCT_NAME=SlideIA
SUPPORT_EMAIL=suporte@$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SIGNING_KEY=$(openssl rand -base64 48 | tr -d '\n')
METRICS_TOKEN=$(openssl rand -hex 24)
BLOB_DRIVER=disk
# No e-mail provider yet: messages only go to the container log (docker compose logs app).
MAIL_DRIVER=console
MAIL_FROM=SlideIA <nao-responda@$DOMAIN>
DEMO_EMAIL=demo@$DOMAIN
DEMO_PASSWORD=$(openssl rand -base64 18 | tr -d '\n/+=')
ENV
  echo "[deploy] .env criado em $REMOTE/.env (segredos gerados no servidor)"
fi
docker compose build app
# `up --build` does not always recreate a container whose config is unchanged; force the app
# onto the new image (the database keeps running).
docker compose up -d db
docker compose up -d --no-deps --force-recreate app
docker image prune -f >/dev/null
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1 && { echo "[deploy] servidor saudável"; exit 0; }
  sleep 2
done
docker compose logs --tail 50 app
echo "[deploy] ERRO: o servidor não respondeu em /healthz" >&2
exit 1
EOF

if [[ $SETUP == 1 ]]; then
  info "Configurando nginx, certificado TLS e backup diário..."
  scp -q "$HERE/nginx-slideia.site.conf" "$VPS:/etc/nginx/sites-available/$DOMAIN"
  ssh "$VPS" DOMAIN="$DOMAIN" REMOTE="$REMOTE" bash -s <<'EOF'
set -euo pipefail
IP=$(curl -fsS https://api.ipify.org)
RESOLVED=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')
[[ "$RESOLVED" == "$IP" ]] || { echo "[deploy] ERRO: $DOMAIN aponta para '${RESOLVED:-nada}', esperado $IP. Ajuste o DNS e rode de novo." >&2; exit 1; }
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t && systemctl reload nginx
certbot --nginx --non-interactive --redirect -d "$DOMAIN" -d "www.$DOMAIN"
( { crontab -l 2>/dev/null || true; } | { grep -v "$REMOTE/backup.sh" || true; }; echo "30 3 * * * $REMOTE/backup.sh >> $REMOTE/backups/backup.log 2>&1" ) | crontab -
echo "[deploy] nginx, TLS e cron de backup prontos"
EOF
fi

info "Pronto: https://$DOMAIN  (MCP: https://$DOMAIN/mcp)"
