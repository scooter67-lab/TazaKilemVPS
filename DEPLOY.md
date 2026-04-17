# Развертывание на VPS через GitHub + PostgreSQL

Цель: поднять приложение на частном VPS, чтобы обновления приходили из GitHub, а данные хранились в PostgreSQL и не терялись при релизах.

## Что уже подготовлено в проекте

- `docker-compose.prod.yml` — production-стек (`db` + `backend` + `frontend`).
- `backend/Dockerfile` — сборка FastAPI сервиса.
- `frontend/Dockerfile` + `frontend/nginx/default.conf` — сборка React и отдача через Nginx.
- `.github/workflows/deploy-vps.yml` — автодеплой по SSH при push в `main`.
- `backend/.env.production.example` и `frontend/.env.production.example` — шаблоны env.

## 1) Подготовка VPS

Установите на сервер:

- Docker Engine
- Docker Compose plugin
- Git

Проверьте:

```bash
docker --version
docker compose version
git --version
```

## 2) Клонирование проекта

```bash
mkdir -p /opt/tazakilem
cd /opt/tazakilem
git clone <YOUR_REPO_URL> app
cd app
```

## 3) Настройка production переменных

```bash
cp backend/.env.production.example backend/.env.production
cp frontend/.env.production.example frontend/.env.production
```

Отредактируйте `backend/.env.production`:

- `SECRET_KEY` — длинный случайный ключ
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `DATABASE_URL` должен совпадать с этими значениями
- `CORS_ORIGINS` для вашего домена (если фронт и API через один домен, оставьте ваш домен)

В `frontend/.env.production` обычно достаточно:

```env
VITE_API_URL=/api
```

## 4) Первый запуск

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Проверка API:

```bash
curl http://<VPS_IP>/api/health
```

Если все хорошо, получите:

```json
{"status":"ok","environment":"production"}
```

## 5) Автодеплой из GitHub

Workflow: `.github/workflows/deploy-vps.yml`

Добавьте в GitHub Secrets:

- `VPS_HOST` — IP/домен VPS
- `VPS_PORT` — обычно `22`
- `VPS_USER` — пользователь SSH
- `VPS_SSH_KEY` — приватный ключ для этого пользователя
- `VPS_APP_DIR` — путь к репозиторию на сервере (например `/opt/tazakilem/app`)

После каждого push в `main` workflow:

1. Подключается к VPS по SSH
2. Делает `git pull --ff-only`
3. Поднимает контейнеры `docker compose up -d --build`

## 6) Резервные копии PostgreSQL

Создать бэкап:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F-%H%M).sql
```

Восстановить:

```bash
cat backup-file.sql | docker compose -f docker-compose.prod.yml exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Рекомендуется сохранять копии в отдельное хранилище (S3/облако/второй диск).

## 7) SSL и домен (рекомендуется)

- Используйте внешний Nginx/Caddy на VPS.
- Проксируйте 80/443 на `frontend` контейнер.
- Выпустите сертификат Let's Encrypt.

## 8) Обновление вручную (если без GitHub Actions)

```bash
cd /opt/tazakilem/app
git pull --ff-only origin main
docker compose -f docker-compose.prod.yml up -d --build
```

## 9) Важный момент по миграциям

При старте backend автоматически выполняет:

- `Base.metadata.create_all(...)` — создание новых таблиц
- `migrate_schema()` — идемпотентные изменения существующей схемы

Это позволяет развивать схему без потери данных при корректных ALTER-изменениях.
