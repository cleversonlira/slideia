#!/bin/bash
# Daily backup of slideia on the VPS: Postgres dump + images/data volume. Keeps 14 days.
# Installed by deploy.sh as /opt/slideia/backup.sh and run by cron at 03:30.
set -euo pipefail
umask 077
cd /opt/slideia
DEST=/opt/slideia/backups
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DEST"

docker compose exec -T db pg_dump -U postgres -d slideia --clean --if-exists | gzip > "$DEST/db_$STAMP.sql.gz"
docker run --rm -v slideia_data:/data:ro -v "$DEST":/backup alpine \
  tar czf "/backup/data_$STAMP.tar.gz" -C /data .

find "$DEST" -name 'db_*.sql.gz' -mtime +14 -delete
find "$DEST" -name 'data_*.tar.gz' -mtime +14 -delete
echo "[backup] $STAMP ok: $(du -sh "$DEST" | cut -f1) em $DEST"
