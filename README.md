# Журнал ковромойки

## 1) Архитектура проекта

- `backend/` — FastAPI API, SQLAlchemy модели, JWT auth, бизнес-логика смен/заявок/ковров.
- `frontend/` — React + TypeScript (Vite), страницы по ТЗ, работа с API.
- Архитектура разделяет ответственность: backend хранит и валидирует данные, frontend управляет UI и пользовательскими сценариями.

## 2) Полная структура backend

```text
backend/
  .env.example
  requirements.txt
  app/
    __init__.py
    auth.py
    config.py
    crud.py
    database.py
    deps.py
    main.py
    models.py
    schemas.py
```

## 3) Полная структура frontend

```text
frontend/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  src/
    App.tsx
    api.ts
    auth.ts
    main.tsx
    types.ts
    pages/
      ActiveShiftPage.tsx
      AdminPanel.tsx
      Dashboard.tsx
      JournalPage.tsx
      LoginPage.tsx
      RequestPage.tsx
```

## 4) Модели БД (SQLAlchemy)

Определены в `backend/app/models.py`:
- `Role(id, name)`
- `User(id, username, password_hash, role, role_id)`
- `Shift(id, user_id, opened_at, closed_at, status)`
- `Request(id, shift_id, request_number)`
- `Carpet(id, request_id, length, width, area)`

Связи:
- `User 1:M Shift`
- `Shift 1:M Request`
- `Request 1:M Carpet`

## 5) Основные API эндпоинты (с кодом)

Реализованы в `backend/app/main.py`:
- Auth: `POST /login`, `POST /refresh`
- Users: `GET /users`, `POST /users`, `PATCH /users/{id}` (admin)
- Shifts: `POST /shifts/open`, `POST /shifts/close`, `GET /shifts/current`, `GET /shifts` (admin)
- Requests: `POST /requests`, `GET /requests/{shift_id}`, `PATCH /requests/{id}`
- Carpets: `POST /carpets`, `PATCH /carpets/{id}`, `DELETE /carpets/{id}`
- Journal: `GET /journals`, `PATCH /journals/{id}` (admin)
- Статистика админки: `GET /stats`

Валидируется:
- `length > 0`, `width > 0` (Pydantic Field gt=0)
- запрет редактирования закрытой смены для обычного пользователя
- проверка доступа по роли и владельцу смены

## 6) Пример React компонентов

Основные страницы:
- `LoginPage` — авторизация, сохранение JWT.
- `Dashboard` — текущая активная смена.
- `ActiveShiftPage` — открыть/закрыть смену, список заявок, итог по смене.
- `RequestPage` — ковры в заявке, добавление/редактирование/удаление, расчет площади.
- `JournalPage` — просмотр закрытых смен.
- `AdminPanel` — управление пользователями/ролями, просмотр смен, статистика.

## 7) Инструкция как запустить проект

### Backend

1. Перейти в `backend/`.
2. Создать `.env` на основе `.env.example`.
3. Установить зависимости:
   - `pip install -r requirements.txt`
4. Запустить:
   - `uvicorn app.main:app --reload`

По умолчанию создается админ:
- логин: `admin`
- пароль: `admin123`

### Frontend

1. Перейти в `frontend/`.
2. Установить зависимости:
   - `npm install`
3. Запустить dev-сервер:
   - `npm run dev`

Frontend ожидает backend по адресу `http://localhost:8000`.

## 8) PWA

Приложение устанавливается на телефон («Добавить на главный экран») и открывается
в отдельном окне без адресной строки. Оболочка (`index.html`, JS, CSS, иконки)
лежит в precache service worker'а: без сети приложение всё равно открывается и
показывает полоску «Нет сети» вместо ошибки браузера. Офлайн-ввода данных нет —
запросы к `/api` всегда идут в сеть и без неё честно падают.

Что где:

- `frontend/vite.config.ts` — плагин `vite-plugin-pwa`: манифест и настройки Workbox.
- `frontend/src/PwaUpdate.tsx` — полоска «Нет сети» и предложение поставить новую версию.
- `frontend/public/` — иконки, нарезанные из логотипа ковромойки
  (исходник `docx/1787488604349.png` в git не хранится):
  - `pwa-192x192.png`, `pwa-512x512.png` — обычные;
  - `pwa-maskable-512x512.png` — под маску Android, значимое в центральных 80%;
  - `apple-touch-icon.png` (180×180) — для iOS, без прозрачности.
- `frontend/nginx/default.conf` — заголовки кэша: `/assets/*` навсегда (в именах хэш
  содержимого), `sw.js`, манифест и `index.html` — `no-cache`, иначе браузер не
  увидит новую версию.

Обновление версии: после деплоя браузер забирает новый `sw.js`, и приложение
показывает «Доступна новая версия» с кнопкой. Молча не перезагружаемся —
пользователь может в этот момент заполнять заявку.

Проверять только на сборке: `npm run build && npm run preview`, дальше в Chrome
DevTools → Application → Manifest / Service workers. В `npm run dev` service
worker не регистрируется.

Замена логотипа: положить новый файл и перенарезать те же четыре png.
