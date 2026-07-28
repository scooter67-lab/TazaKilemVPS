#!/usr/bin/env bash
# Деплой с рабочей машины: привозит исходники на сервер, собирает и поднимает.
# То же самое делает .github/workflows/deploy-vps.yml, но раннеру GitHub
# сеть провайдера не даёт достучаться до VPS (см. DEPLOY.md, раздел 0).
#
# Запускать из корня репозитория:  ./scripts/deploy.sh
set -euo pipefail

HOST="${VPS_HOST:-magazine.tbgroup.kz}"
USER_="${VPS_USER:-ilya}"
PORT="${VPS_PORT:-22}"
APP_DIR="${VPS_APP_DIR:-/opt/tazakilem/app}"
TARGET="${USER_}@${HOST}"

[ -f docker-compose.prod.yml ] || { echo "Запускайте из корня репозитория"; exit 1; }

echo "==> Доставка исходников на ${TARGET}:${APP_DIR}"
ssh -p "$PORT" "$TARGET" "mkdir -p '$APP_DIR'"
# .env.production не отправляем: секреты живут только на сервере
tar czf - \
  --exclude=node_modules --exclude=dist --exclude=__pycache__ \
  --exclude='*.db' --exclude='.env' --exclude='.env.production' \
  backend frontend caddy docker-compose.prod.yml \
  | ssh -o ServerAliveInterval=30 -p "$PORT" "$TARGET" "tar xzf - -C '$APP_DIR'"

echo "==> Сборка и запуск"
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=20 -p "$PORT" "$TARGET" bash -s <<REMOTE
set -e
cd "$APP_DIR"
if [ ! -f backend/.env.production ]; then
  echo "ОШИБКА: backend/.env.production отсутствует (см. DEPLOY.md, шаг 3)."
  exit 1
fi
# Сборка до пересоздания контейнеров: если упадёт, стек останется на прежней версии
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker image prune -f
REMOTE

echo "==> Проверка, что сайт отвечает"
for i in $(seq 1 12); do
  code=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "https://${HOST}/api/health" || echo 000)
  echo "попытка $i: HTTP $code"
  if [ "$code" = "200" ]; then
    echo "деплой подтверждён"
    exit 0
  fi
  sleep 10
done
echo "ОШИБКА: /api/health не ответил 200 за 2 минуты"
exit 1
