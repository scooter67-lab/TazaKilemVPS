#!/usr/bin/env bash
# Ежедневный дамп PostgreSQL на самом сервере.
#
# Ставится один раз в /opt/tazakilem/bin/ и запускается из crontab пользователя
# ilya — деплой сюда не заглядывает (он везёт только backend/, frontend/, caddy/
# и compose-файл), поэтому после правок скрипт надо переустановить вручную:
# см. DEPLOY.md, раздел 6.
#
# Копии лежат рядом с приложением, на том же диске: это спасает от кривой
# миграции и удалённых данных, но не от потери самого VPS.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tazakilem/app}"
DEST="${DEST:-/opt/tazakilem/backups}"
KEEP="${KEEP:-14}"

cd "$APP_DIR"
mkdir -p "$DEST"

stamp=$(date +%F-%H%M)
tmp="$DEST/.tmp-$stamp.sql.gz"
out="$DEST/carpet_journal-$stamp.sql.gz"
trap 'rm -f "$tmp"' EXIT

# Имя базы и пользователь берутся из окружения контейнера: в .env.production
# они уже есть, дублировать секреты в crontab незачем.
# </dev/null обязателен: exec пробрасывает stdin в контейнер, и запущенный
# из другого скрипта pg_dump сожрёт остаток этого скрипта.
docker compose -f docker-compose.prod.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' </dev/null | gzip >"$tmp"

# Пустой или битый архив не должен вытеснить рабочую копию из ротации.
gzip -t "$tmp"
[ "$(stat -c%s "$tmp")" -gt 1000 ] || { echo "дамп подозрительно мал, не сохраняю"; exit 1; }

mv "$tmp" "$out"
trap - EXIT

# Оставляем KEEP свежих копий.
ls -1t "$DEST"/carpet_journal-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "$(date -Is) ok $out $(stat -c%s "$out") байт, копий: $(ls -1 "$DEST"/carpet_journal-*.sql.gz | wc -l)"
