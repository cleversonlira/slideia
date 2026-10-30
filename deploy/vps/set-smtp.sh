#!/bin/bash
# Configures outgoing e-mail on the VPS through Hostinger's SMTP (suporte@slideia.site).
# Asks for the mailbox password without echoing it and sends it inside the ssh stdin script,
# so it never appears in command arguments, shell history or logs. Run in your own terminal:
#
#   deploy/vps/set-smtp.sh [mailbox]        # default: suporte@slideia.site
set -euo pipefail

VPS="${VPS:-root@46.202.88.184}"
REMOTE="${REMOTE:-/opt/slideia}"
MAILBOX="${1:-suporte@slideia.site}"
HOST="smtp.hostinger.com"

read -r -s -p "Senha da caixa $MAILBOX: " PASSWORD
echo
[[ -n "$PASSWORD" ]] || { echo "Senha vazia." >&2; exit 1; }

# User and password are URL-encoded inside SMTP_URL (smtps = TLS on port 465).
URL=$(printf '%s\n%s' "$MAILBOX" "$PASSWORD" | python3 -I -c '
import sys, urllib.parse as u
user, pw = sys.stdin.read().split("\n", 1)
print(f"smtps://{u.quote(user, safe=str())}:{u.quote(pw, safe=str())}@'"$HOST"':465")')

# bash -s reads the script line by line, so the first `read` consumes the URL line after it.
{
  echo 'read -r SMTP_URL'
  printf '%s\n' "$URL"
  cat <<'EOF'
set -euo pipefail
cd "$REMOTE"
umask 077
{ grep -vE '^(MAIL_DRIVER|SMTP_URL|MAIL_FROM|SUPPORT_EMAIL)=' .env || true; } > .env.new
printf 'MAIL_DRIVER=smtp\nSMTP_URL=%s\nMAIL_FROM=SlideIA <%s>\nSUPPORT_EMAIL=%s\n' \
  "$SMTP_URL" "$MAILBOX" "$MAILBOX" >> .env.new
mv .env.new .env
if [[ "${DRY_RUN:-0}" != "1" ]]; then
  docker compose up -d app >/dev/null 2>&1
  for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1 && break; sleep 2; done
  docker compose logs app --since 2m 2>&1 | grep -o '"mail":"[a-z]*"' | tail -1
fi
EOF
} | ssh "$VPS" "MAILBOX='$MAILBOX' REMOTE='$REMOTE' DRY_RUN='${DRY_RUN:-0}' bash -s"

echo "E-mail configurado: envio por $HOST como $MAILBOX."
