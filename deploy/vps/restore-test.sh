#!/bin/bash
# Checks that the newest backup restores: loads the dump into a throwaway Postgres (no network,
# removed at the end) and lists the image archive. Production is not touched.
#   ssh root@46.202.88.184 /opt/slideia/restore-test.sh
set -euo pipefail
cd /opt/slideia
DB=$(ls -t backups/db_*.sql.gz | head -1)
DATA=$(ls -t backups/data_*.tar.gz | head -1)
NAME=slideia-restore-test
trap 'docker rm -f $NAME >/dev/null 2>&1 || true' EXIT

docker run -d --name $NAME --network none -e POSTGRES_PASSWORD=x -e POSTGRES_DB=slideia \
  postgres:17-alpine >/dev/null
for _ in $(seq 60); do
  docker exec $NAME psql -h 127.0.0.1 -U postgres -d slideia -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
gunzip -c "$DB" | docker exec -i $NAME psql -q -v ON_ERROR_STOP=1 -U postgres -d slideia >/dev/null
q() { docker exec $NAME psql -U postgres -d slideia -Atc "$1"; }
echo "[restore] $DB: $(q 'select count(*) from users') usuários, $(q 'select count(*) from presentations') apresentações, $(q 'select count(*) from assets') imagens"
tar tzf "$DATA" >/dev/null
echo "[restore] $DATA: $(tar tzf "$DATA" | grep -c '^./blobs/.') arquivos de imagem"
echo "[restore] ok"
