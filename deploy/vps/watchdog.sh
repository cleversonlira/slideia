#!/bin/bash
# Watchdog for slideia on the VPS, run by cron every 5 minutes (installed by deploy.sh).
# Emails ALERT_EMAIL (default SUPPORT_EMAIL) through the SMTP_URL in .env when:
#   - https://$DOMAIN/healthz fails twice in a row (and again when it recovers);
#   - the newest database backup is older than 30 hours;
#   - the TLS certificate expires in less than 14 days;
#   - the root disk is more than 90% full.
# Each problem is reported once when it starts and once when it clears (state in watchdog.state).
# It cannot report the VPS itself being down: use an external monitor for that (docs/REMOTO.md).
#
#   watchdog.sh          # check now
#   watchdog.sh --test   # send a test email
set -uo pipefail
cd /opt/slideia
env_get() { sed -n "s/^$1=//p" .env | tail -1; }
SMTP_URL=$(env_get SMTP_URL)
FROM=$(env_get MAIL_FROM)
TO=$(env_get ALERT_EMAIL); TO=${TO:-$(env_get SUPPORT_EMAIL)}
DOMAIN=$(env_get PUBLIC_URL | sed -E 's#^https?://##; s#/.*##')
STATE=/opt/slideia/watchdog.state
touch "$STATE"

send() { # subject, body
  local addr; addr=$(sed -E 's/.*<([^>]+)>.*/\1/' <<<"$FROM")
  [[ -n "$SMTP_URL" && -n "$TO" ]] || { echo "[watchdog] sem SMTP_URL/destinatário: $1" >&2; return 1; }
  printf 'From: %s\r\nTo: %s\r\nSubject: [%s] %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s\r\n\r\n%s\r\n' \
    "$FROM" "$TO" "$DOMAIN" "$1" "$2" "$(date '+%Y-%m-%d %H:%M %Z') - $(hostname)" |
    curl -sS --ssl-reqd --max-time 30 --url "$SMTP_URL" --mail-from "$addr" --mail-rcpt "$TO" -T - \
    && echo "[watchdog] enviado: $1"
}

# report KEY "problem description" | report KEY  (no description = OK). Mails on transitions only.
report() {
  local key=$1 msg=${2:-} was
  was=$(grep -c "^$key$" "$STATE")
  if [[ -n "$msg" && $was == 0 ]]; then
    send "ALERTA: $msg" "$msg" && echo "$key" >>"$STATE"
  elif [[ -z "$msg" && $was != 0 ]]; then
    send "OK: $key normalizado" "O problema '$key' não ocorre mais." && sed -i "/^$key$/d" "$STATE"
  fi
}

if [[ "${1:-}" == "--test" ]]; then send "teste do watchdog" "Se você recebeu isto, os alertas funcionam."; exit; fi

# Health: two consecutive failures before alerting (deploys restart the app for a few seconds).
if curl -fsS --max-time 15 "https://$DOMAIN/healthz" >/dev/null 2>&1; then
  sed -i '/^health-fail-1$/d' "$STATE"; report health
elif grep -q '^health-fail-1$' "$STATE"; then
  report health "https://$DOMAIN não responde. Últimos logs:
$(docker compose ps 2>&1)
$(docker compose logs --tail 30 app 2>&1)"
else
  echo health-fail-1 >>"$STATE"
fi

newest=$(find backups -name 'db_*.sql.gz' -mmin -1800 | head -1)
[[ -n "$newest" ]] && report backup || report backup "nenhum backup do banco nas últimas 30 horas (veja backups/backup.log)"

end=$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [[ -n "$end" ]]; then
  days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  (( days >= 14 )) && report tls || report tls "o certificado TLS expira em $days dias (certbot renew falhou?)"
fi

use=$(df --output=pcent / | tail -1 | tr -dc 0-9)
(( use <= 90 )) && report disk || report disk "disco em ${use}% de uso"
exit 0
