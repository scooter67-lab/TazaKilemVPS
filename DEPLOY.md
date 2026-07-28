# Развертывание на VPS через GitHub + PostgreSQL

Цель: поднять приложение на частном VPS, чтобы обновления приходили из GitHub, а данные хранились в PostgreSQL и не терялись при релизах.

## Что уже подготовлено в проекте

- `docker-compose.prod.yml` — production-стек (`db` + `backend` + `frontend` + `caddy`).
- `backend/Dockerfile` — сборка FastAPI сервиса.
- `frontend/Dockerfile` + `frontend/nginx/default.conf` — сборка React и отдача через Nginx.
- `caddy/Caddyfile` — HTTPS на сертификате Let's Encrypt (выпуск через DNS-01, см. раздел 7).
- `.github/workflows/deploy-vps.yml` — автодеплой при push в `main`.
- `backend/.env.production.example` — шаблон env.

## 0) Особенность сети этого VPS (важно)

С `magazine.tbgroup.kz` провайдер режет GitHub на уровне DPI: TCP-соединение
устанавливается, но TLS ClientHello остаётся без ответа. Недоступны `github.com`,
`codeload.github.com`, `raw.githubusercontent.com` и **`ghcr.io`**. Доступны Docker Hub,
Let's Encrypt и репозитории Ubuntu. IPv6 не обходит блокировку: у GitHub нет
AAAA-записей.

Из этого следует архитектура деплоя:

- на сервере **нет `git pull`** — исходники привозит раннер по ssh
  (`tar` на раннере → `tar` на сервере) при каждом деплое;
- **реестр образов не используется** — сервер собирает образы у себя.
  Аккаунт в Docker Hub или GHCR не нужен;
- соединение всегда идёт снаружи внутрь (раннер → VPS), а входящий трафик
  фильтром не задет.

Фильтруется именно **исходящий** трафик, и это бьёт не только по GitHub. Замер
tcpdump во время ACME-проверки: входящие SYN от проверяющих точек Let's Encrypt
доходят все, но наши ответы уходят в ретрансмиссии (49 штук за одну проверку),
и часть валидаторов ответа не получает. Поэтому сертификат выпускается через
DNS-01 — см. раздел 7.

Если провайдер когда-нибудь снимет блокировку, доставку можно упростить
до `git pull` на сервере, а Caddy вернуть в режим автоматического HTTPS.

## 1) Подготовка VPS

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 docker-buildx
sudo systemctl enable --now docker
sudo usermod -aG docker <ваш_пользователь>   # деплой ходит по ssh без sudo
```

Официального репозитория Docker под Ubuntu 26.04 «resolute» пока нет — ставим
пакеты из репозиториев самой Ubuntu, версии там свежие.

Swap (страховка от OOM во время сборки фронтенда):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Файрвол:

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable
```

Порт 80 нужен для редиректа http → https. Владение доменом Let's Encrypt проверяет
не через него, а по TXT-записи в DNS (раздел 7).

## 2) Каталог приложения

Клонировать репозиторий на сервер не нужно и не получится (см. раздел 0):

```bash
sudo mkdir -p /opt/tazakilem/app && sudo chown $USER:$USER /opt/tazakilem/app
mkdir -p /opt/tazakilem/app/caddy /opt/tazakilem/app/backend
```

## 3) Настройка production переменных

```bash
cp backend/.env.production.example backend/.env.production
```

Отредактируйте `backend/.env.production`:

- `SECRET_KEY` — случайный ключ от 32 символов, сгенерировать:
  `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `DATABASE_URL` должен совпадать с этими значениями
- `CORS_ORIGINS` для вашего домена (если фронт и API через один домен, оставьте ваш домен)

Backend откажется стартовать в production, если `SECRET_KEY` или пароль БД остались
шаблонными из `.env.production.example` — это защита от случайного деплоя с дефолтными секретами.

Пароль Postgres читается только при первой инициализации тома `pg_data`. Задайте его
до первого запуска: сменить позже без пересоздания тома не получится.

`frontend/.env.production` создавать не нужно — `VITE_API_URL=/api` передаётся как build-arg
в `docker-compose.prod.yml`.

## 4) Первый запуск

Штатный путь — workflow (вкладка Actions → Deploy to VPS → Run workflow):
он привезёт исходники на сервер, соберёт образы там же и поднимет стек.

Вручную на сервере, если исходники уже лежат в `/opt/tazakilem/app`:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Проверка API (сертификат должен быть выпущен заранее — раздел 7):

```bash
curl https://magazine.tbgroup.kz/api/health
```

Если все хорошо, получите:

```json
{"status":"ok","environment":"production"}
```

## 5) Автодеплой из GitHub

Workflow: `.github/workflows/deploy-vps.yml`

Добавьте в GitHub Secrets:

| Секрет | Значение |
|---|---|
| `VPS_HOST` | `magazine.tbgroup.kz` |
| `VPS_PORT` | `22` |
| `VPS_USER` | `ilya` |
| `VPS_APP_DIR` | `/opt/tazakilem/app` |
| `VPS_SSH_KEY` | приватный ключ deploy-пары (публичная половина — в `~/.ssh/authorized_keys` на сервере) |

Учётных данных реестра не требуется: образы собираются на сервере (раздел 0).

После каждого push в `main` workflow выполняет одну джобу `deploy`:

1. Кладёт `VPS_SSH_KEY` на раннер и добавляет хост в `known_hosts`
2. Отправляет исходники (`backend/`, `frontend/`, `caddy/`, `docker-compose.prod.yml`)
   одним потоком: `tar czf -` на раннере → `tar xzf -` в `$VPS_APP_DIR`.
   `backend/.env.production` в архив не входит, поэтому секреты на сервере не затираются
3. Проверяет наличие `backend/.env.production` (нет файла — деплой падает,
   секреты не создаются автоматически)
4. `docker compose build`, затем `up -d`. Сборка идёт отдельным шагом до пересоздания
   контейнеров: если она упадёт, работающий стек останется на прежней версии
5. `docker image prune -f` — чистит слои прошлых релизов
6. Дёргает `https://magazine.tbgroup.kz/api/health` и падает, если за 2 минуты нет `200`

Первая сборка занимает несколько минут (`npm ci` + `vite build`), последующие быстрее
за счёт кэша слоёв Docker на сервере.

### Откат на предыдущую версию

Реестра с тегами по коммитам нет, поэтому откат — это повторный деплой нужного
коммита: в GitHub откройте Actions → Deploy to VPS → Run workflow и выберите
ветку/тег. Либо на сервере верните прошлые исходники и пересоберите.

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

## 7) SSL и домен

Домен: **magazine.tbgroup.kz** → 91.217.10.20 (A-запись уже настроена).

HTTPS терминирует контейнер `caddy` из `docker-compose.prod.yml`:

- слушает 80 и 443, редиректит http → https;
- проксирует всё на контейнер `frontend`, где nginx уже разводит `/api` на backend;
- конфиг — `caddy/Caddyfile`, домен подставляется переменной `DOMAIN` из compose;
- сертификат **не выпускает сам** — берёт готовый из `/etc/letsencrypt`.

Контейнер `frontend` наружу больше не публикуется — только через Caddy.

### Почему сертификат выпускается вручную

Автоматический режим Caddy здесь не работает. С 2025 года центры сертификации
обязаны проверять домен из нескольких точек мира (multi-perspective validation)
и требуют кворума. Провайдер этого VPS отбрасывает исходящий трафик к части
зарубежных сетей: входящие SYN доходят, а наши ответы уходят в ретрансмиссии.
В результате падают обе проверки — и `http-01`, и `tls-alpn-01`:

```
challenge failed ... During secondary validation: 91.217.10.20:
Timeout after connect (your server may be slow or overloaded)
```

`DNS-01` проверяет только TXT-запись в зоне и сеть машины не задействует.

### Выпуск сертификата

```bash
sudo apt-get install -y certbot
sudo certbot certonly --manual --preferred-challenges dns \
  --manual-auth-hook /usr/local/bin/dns_auth_hook.sh \
  --manual-cleanup-hook /bin/true \
  -d magazine.tbgroup.kz \
  --agree-tos --register-unsafely-without-email \
  --non-interactive --key-type ecdsa
```

Хук лежит в репозитории — `scripts/dns_auth_hook.sh`, на сервер ставится так:

```bash
sudo install -m 755 scripts/dns_auth_hook.sh /usr/local/bin/dns_auth_hook.sh
```

Он печатает нужное значение TXT и ждёт, пока запись
появится в зоне (опрашивает 8.8.8.8 и 1.1.1.1 раз в 15 секунд, до 40 минут).
Запись создаётся в панели PS.kz:

| поле | значение |
|---|---|
| Хост | `_acme-challenge.magazine` |
| Тип | `TXT` |
| TTL | `300` |
| Значение | токен из вывода хука |

Токен одноразовый и меняется при каждом запросе. После выпуска запись можно удалить.

Запускайте certbot отвязанным от SSH-сессии (`nohup setsid ... &`), иначе обрыв
связи убьёт процесс на середине.

### Продление

Срок жизни сертификата — 90 дней. Продление тем же способом, с новым токеном:

```bash
sudo certbot renew
sudo docker compose -f /opt/tazakilem/app/docker-compose.prod.yml restart caddy
```

Caddy не перечитывает файлы сертификатов сам, поэтому рестарт обязателен.

Полностью автоматическим продление станет, если у PS.kz найдётся API для записей
либо если делегировать `_acme-challenge.magazine` записью CNAME в зону, к API
которой есть доступ.

**Что нужно на сервере:**

1. Открыть в файрволе 80 и 443:
   ```bash
   sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
   ```
2. Убедиться, что порты никем не заняты (`sudo ss -tlnp | grep -E ':80|:443'`).

Каталог `/etc/letsencrypt` монтируется в контейнер только на чтение — не удаляйте
его, там лежат сертификат и ключ аккаунта.

Другой домен — задайте `DOMAIN` в окружении compose, выпустите сертификат на новое
имя и поправьте `CORS_ORIGINS` в `backend/.env.production`.

## 8) Обновление вручную (если без GitHub Actions)

`git pull` на сервере не работает (раздел 0), поэтому исходники доставляются
с рабочей машины тем же способом, что и в workflow:

```bash
# из корня репозитория локально
tar czf - \
  --exclude=node_modules --exclude=dist --exclude=__pycache__ \
  --exclude='*.db' --exclude='.env' --exclude='.env.production' \
  backend frontend caddy docker-compose.prod.yml \
  | ssh ilya@magazine.tbgroup.kz "tar xzf - -C /opt/tazakilem/app"
ssh ilya@magazine.tbgroup.kz \
  "cd /opt/tazakilem/app && docker compose -f docker-compose.prod.yml up -d --build"
```

## 9) Важный момент по миграциям

При старте backend автоматически выполняет:

- `Base.metadata.create_all(...)` — создание новых таблиц
- `migrate_schema()` — идемпотентные изменения существующей схемы

Это позволяет развивать схему без потери данных при корректных ALTER-изменениях.
