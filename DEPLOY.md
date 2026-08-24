# Развертывание на VPS через GitHub + PostgreSQL

Цель: поднять приложение на частном VPS, чтобы обновления приходили из GitHub, а данные хранились в PostgreSQL и не терялись при релизах.

## Что уже подготовлено в проекте

- `docker-compose.prod.yml` — production-стек (`db` + `backend` + `frontend` + `caddy`).
- `backend/Dockerfile` — сборка FastAPI сервиса.
- `frontend/Dockerfile` + `frontend/nginx/default.conf` — сборка React и отдача через Nginx.
- `frontend/vite.config.ts` + `frontend/public/` — PWA: манифест, service worker, иконки.
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

### Как именно это выглядит на уровне пакетов

Замеры tcpdump на сервере показывают одну и ту же картину: **TCP-соединение
устанавливается полностью, а первый пакет с полезной нагрузкой пропадает.**

Пример — попытка раннера GitHub (Azure, `20.161.60.101`) подключиться по SSH:

```
20.161.60.101 > 91.217.10.20.22: Flags [S]        SYN прошёл
91.217.10.20.22 > 20.161.60.101: Flags [S.]       мы ответили
20.161.60.101 > 91.217.10.20.22: Flags [.]        ACK прошёл
91.217.10.20.22 > 20.161.60.101: Flags [P.] len 42  наш SSH-баннер ушёл
20.161.60.101 > 91.217.10.20.22: Flags [.] ack 43   баннер подтверждён
                                                    ... и больше ничего
```

Пакетов с данными от раннера — **ноль**. Его SSH-баннер до нас не доходит.
Ровно то же наблюдается в обратную сторону при обращении к `github.com`:
TCP открывается, наш TLS ClientHello остаётся без ответа.

Затронуты не все сети: часть проверяющих точек Let's Encrypt отрабатывает
нормально, соединения из Казахстана работают полностью.

Практические следствия:

- **GitHub Actions деплоить не может** — раннер не устанавливает SSH-сессию.
  Рабочий способ — `./scripts/deploy.sh` с машины разработчика (раздел 5).
- **ACME-проверки http-01 и tls-alpn-01 не проходят** — запрос валидатора
  до сервера не доходит. Сертификат выпускается через DNS-01 (раздел 7).

Если провайдер снимет фильтрацию, всё упрощается разом: workflow заработает
без правок, Caddy можно вернуть в режим автоматического HTTPS, а доставку —
на `git pull`.

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

## 5) Деплой

### Рабочий способ: `scripts/deploy.sh` с машины разработчика

```bash
./scripts/deploy.sh
```

Скрипт делает ровно то же, что workflow: привозит исходники, собирает образы
на сервере, поднимает стек и проверяет `/api/health`. Хост, пользователь, порт
и каталог переопределяются переменными `VPS_HOST`, `VPS_USER`, `VPS_PORT`,
`VPS_APP_DIR`; значения по умолчанию — рабочие.

`backend/.env.production` не отправляется: секреты живут только на сервере.

Первая сборка занимает несколько минут (`npm ci` + `vite build`), последующие
быстрее за счёт кэша слоёв Docker на сервере.

### GitHub Actions: подготовлено, но не работает

Workflow: `.github/workflows/deploy-vps.yml`

Раннер GitHub не может завершить SSH-рукопожатие с этим VPS (раздел 0), поэтому
автозапуск по push отключён — остался только ручной `workflow_dispatch`. Логика
внутри та же, что в `deploy.sh`: как только провайдер снимет фильтрацию, workflow
заработает без правок. Проверить это можно запуском вручную.

Секреты для него уже проставлены:

| Секрет | Значение |
|---|---|
| `VPS_HOST` | `magazine.tbgroup.kz` |
| `VPS_PORT` | `22` |
| `VPS_USER` | `ilya` |
| `VPS_APP_DIR` | `/opt/tazakilem/app` |
| `VPS_SSH_KEY` | приватный ключ deploy-пары (публичная половина — в `~/.ssh/authorized_keys` на сервере) |

Учётных данных реестра не требуется: образы собираются на сервере (раздел 0).

Джоба `deploy` выполняет:

1. Кладёт `VPS_SSH_KEY` на раннер и добавляет хост в `known_hosts` ← **падает здесь**
2. Отправляет исходники (`backend/`, `frontend/`, `caddy/`, `docker-compose.prod.yml`)
   одним потоком: `tar czf -` на раннере → `tar xzf -` в `$VPS_APP_DIR`.
   `backend/.env.production` в архив не входит, поэтому секреты на сервере не затираются
3. Проверяет наличие `backend/.env.production` (нет файла — деплой падает,
   секреты не создаются автоматически)
4. `docker compose build`, затем `up -d`. Сборка идёт отдельным шагом до пересоздания
   контейнеров: если она упадёт, работающий стек останется на прежней версии
5. `docker image prune -f` — чистит слои прошлых релизов
6. Дёргает `https://magazine.tbgroup.kz/api/health` и падает, если за 2 минуты нет `200`

### Откат на предыдущую версию

Реестра с тегами по коммитам нет, поэтому откат — это повторный деплой нужного
коммита: переключитесь на него локально и запустите скрипт заново.

```bash
git checkout <sha_предыдущего_коммита>
./scripts/deploy.sh
git checkout main
```

## 6) Резервные копии PostgreSQL

Раз в сутки в 03:17 по времени сервера cron пользователя `ilya` запускает
`/opt/tazakilem/bin/backup-db.sh`: тот снимает `pg_dump`, жмёт gzip, проверяет
архив на целостность и кладёт в `/opt/tazakilem/backups/`. Хранится 14 последних
копий, лог — `/opt/tazakilem/backups/backup.log`.

Копии лежат на том же диске, что и база. Это спасает от неудачной миграции,
удалённых данных и порчи тома, но **не от потери самого VPS** — вынос копий
наружу пока не сделан (см. раздел 10).

Исходник скрипта — `scripts/backup-db.sh` в репозитории. Деплой его на сервер не
возит (`deploy.sh` отправляет только `backend/`, `frontend/`, `caddy/` и
compose-файл), поэтому после правок скрипт переустанавливается вручную:

```bash
scp scripts/backup-db.sh ilya@magazine.tbgroup.kz:/opt/tazakilem/bin/backup-db.sh
ssh ilya@magazine.tbgroup.kz chmod +x /opt/tazakilem/bin/backup-db.sh
```

Расписание, если его придётся ставить заново:

```
17 3 * * * /opt/tazakilem/bin/backup-db.sh >>/opt/tazakilem/backups/backup.log 2>&1
```

Снять копию прямо сейчас, не дожидаясь ночи:

```bash
ssh ilya@magazine.tbgroup.kz /opt/tazakilem/bin/backup-db.sh
```

Забрать копии к себе:

```bash
scp 'ilya@magazine.tbgroup.kz:/opt/tazakilem/backups/*.sql.gz' ./
```

### Восстановление

Проверить копию, не трогая боевую базу — развернуть её в отдельную базу рядом:

```bash
gzip -dc backup.sql.gz | docker exec -i app-db-1 sh -c   'psql -U "$POSTGRES_USER" -d restore_check -v ON_ERROR_STOP=1 -f -'
```

(перед этим `create database restore_check;`, после проверки `drop database`).

Восстановить поверх боевой базы:

```bash
gzip -dc backup.sql.gz | docker compose -f docker-compose.prod.yml exec -T db   sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Дамп содержит только данные и схему, он не удаляет существующие таблицы —
восстанавливать надо в пустую базу, иначе получите конфликты по первичным ключам.

`</dev/null` в скрипте не для красоты: `docker compose exec -T` пробрасывает
stdin в контейнер, и запущенный из другого скрипта `pg_dump` съедает остаток
этого скрипта.

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
и требуют кворума. До этого сервера запросы части валидаторов не доходят:
TCP-соединение открывается, а HTTP-запрос теряется (подробности — раздел 0).
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

## 8) Обновление

`./scripts/deploy.sh` из корня репозитория — см. раздел 5.

`git pull` на сервере не работает (раздел 0), поэтому исходники всегда приезжают
с рабочей машины.

Фронтенд — PWA (README, раздел 8). После деплоя открытые вкладки не обновятся
сами: приложение покажет «Доступна новая версия» с кнопкой. Если новую версию
не видно совсем — проверьте, что `sw.js` отдаётся с `Cache-Control: no-cache`
(`curl -I https://$DOMAIN/sw.js`).

## 9) Важный момент по миграциям

При старте backend автоматически выполняет:

- `Base.metadata.create_all(...)` — создание новых таблиц
- `migrate_schema()` — идемпотентные изменения существующей схемы

Это позволяет развивать схему без потери данных при корректных ALTER-изменениях.

## 10) Состояние на 28.07.2026

Проект развёрнут и работает: https://magazine.tbgroup.kz

Проверено: `/api/health` отвечает `{"status":"ok","environment":"production"}`, вход
выдаёт JWT, `/api/users` под токеном отдаёт данные, без токена — 401, http
редиректится на https (308), заголовок HSTS на месте.

Сервер: 91.217.10.20, пользователь `ilya`, каталог `/opt/tazakilem/app`,
2 vCPU / 3.8 ГБ. Контейнеры: `db`, `backend`, `frontend`, `caddy`.

### Что осталось сделать

- [ ] **Сменить пароль `admin`** — до сих пор стоит `admin123` на публичном сайте.
      Это первое, чем стоит заняться.
- [ ] Сменить временный пароль sudo пользователя `ilya` — он засветился в истории
      команд и в переписке.
- [ ] **Продлить сертификат до 26.10.2026** — вручную, см. раздел 7.
- [ ] **Вынести копии БД за пределы VPS** — ежедневные дампы делаются
      (раздел 6), но лежат на том же диске, что и база. Потеря сервера = потеря
      данных. GitHub с сервера недоступен (раздел 0), так что канал нужен другой.
- [ ] **Убрать вход по паролю и root по ssh** — `/etc/ssh/sshd_config.d/99-root-ssh.conf`
      включает `PermitRootLogin yes` и `PasswordAuthentication yes`. `Include` в
      главном конфиге стоит строкой 24, то есть раньше строк 54/78/85 с `no`,
      а выигрывает первое вхождение — значит действует именно drop-in. Проверено
      на живом сервере: предлагаются `publickey,password,keyboard-interactive`,
      в том числе для `root`. Готовый скрипт — `scripts/harden-ssh.sh`.
      Отложено по решению владельца 24.08.2026, вместе с fail2ban.
- [ ] Написать в техподдержку провайдера про фильтрацию (раздел 0). Материалы
      для обращения собраны отдельно, вне репозитория:
      `D:\Cursor\tazakilem-diagnostics\` — дампы tcpdump, их расшифровки
      обычным текстом, журнал ошибок Let's Encrypt, состояние сервера и
      `README.txt` с описью. Секретов в этих файлах нет, отправлять можно как есть.

Если провайдер снимет ограничение, вернуть автодеплой: в
`.github/workflows/deploy-vps.yml` добавить обратно триггер `push` — всё
остальное там уже готово.
