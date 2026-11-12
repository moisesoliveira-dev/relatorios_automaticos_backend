#!/bin/bash
# Backup do banco do sistema (Postgres do Docker). Guarda os últimos 14 dias em /root/backups.
# Instalar: veja deploy/hostinger/LEIAME.md. Rodar à mão: /root/backup-banco.sh
set -euo pipefail

DESTINO=/root/backups
DIAS=14

DB=$(docker ps --filter "ancestor=postgres:17-alpine" --format '{{.Names}}' | head -1)
if [ -z "$DB" ]; then
  echo "$(date '+%F %T') ERRO: container do banco não encontrado"
  exit 1
fi

mkdir -p "$DESTINO"
ARQ="$DESTINO/relatorios-$(date +%Y%m%d-%H%M).sql.gz"
docker exec "$DB" pg_dump -U relatorios -d relatorios --no-owner --no-acl | gzip > "$ARQ"

# arquivo vazio ou minúsculo = falha: não deixa um backup falso
if [ "$(stat -c %s "$ARQ")" -lt 2000 ]; then
  rm -f "$ARQ"
  echo "$(date '+%F %T') ERRO: o backup saiu vazio"
  exit 1
fi

find "$DESTINO" -name 'relatorios-*.sql.gz' -mtime +"$DIAS" -delete
echo "$(date '+%F %T') OK $ARQ ($(du -h "$ARQ" | cut -f1))"
