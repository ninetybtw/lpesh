# LexPrep API

Реальный бэкенд LexPrep — Node.js + Express + Postgres (через Prisma).
Начали с аутентификации и профиля; остальные системы (тарифы, монеты,
дуэли, турниры, рейтинг) сейчас всё ещё живут в localStorage на
фронтенде и будут переезжать сюда постепенно, отдельными шагами.

## Запуск локально

1. Нужен запущенный Postgres. Проще всего через Docker:
   ```bash
   docker run -d --name lexprep-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=lexprep -p 5432:5432 postgres:16
   ```
   Или свой локальный Postgres — главное, чтобы данные из `DATABASE_URL` ниже совпадали.

2. Скопируй `.env.example` в `.env` и поправь `DATABASE_URL`/`JWT_SECRET`, если нужно:
   ```bash
   cp .env.example .env
   ```

3. Установи зависимости и накати миграции:
   ```bash
   npm install
   npm run prisma:migrate
   ```

4. Запусти сервер в режиме разработки:
   ```bash
   npm run dev
   ```
   API поднимется на `http://localhost:4000`.

5. Фронтенд (например, `python3 -m http.server 8971` в корне репозитория)
   должен быть указан в `FRONTEND_ORIGIN` — сервер отдаёт CORS-заголовки
   только для него, с `credentials: true` (cookie-сессия).

   **Важно:** открывай фронтенд именно как `http://localhost:8971`, а не
   `http://127.0.0.1:8971`. Cookie-сессия — `SameSite=Lax`, а браузер
   считает `localhost` и `127.0.0.1` разными сайтами: с `127.0.0.1` cookie
   от API на `localhost:4000` просто не будет прикрепляться к запросам, и
   `/api/auth/me` будет всегда отвечать 401, даже сразу после успешного
   входа.

## Эндпоинты

Все запросы и ответы — JSON. Сессия — httpOnly cookie `lexprep_session`
(JWT), а не токен в теле ответа, поэтому фронтенд должен слать
`fetch(..., { credentials: 'include' })`.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` → создаёт пользователя, ставит cookie |
| POST | `/api/auth/login` | `{ email, password }` → проверяет пароль, ставит cookie |
| POST | `/api/auth/logout` | Снимает cookie |
| GET | `/api/auth/me` | Текущий пользователь по cookie (401, если не авторизован) |
| PATCH | `/api/profile` | `{ name?, avatarUrl? }` → обновляет профиль |
| DELETE | `/api/profile` | Безвозвратно удаляет аккаунт, снимает cookie |

Пароль хранится как bcrypt-хэш, в базе никогда не лежит в открытом виде.
Валидация email/пароля на сервере зеркалит правила из `validation.js` на
фронтенде — клиентская проверка удобства ради, серверная обязательна.

## Структура

```
backend/
  prisma/schema.prisma   — модель User (email, passwordHash, name, avatarUrl, referralCode)
  src/
    index.js             — Express-приложение, CORS, монтирование роутов
    db.js                 — синглтон Prisma Client
    middleware/auth.js     — requireAuth: читает cookie, подставляет req.user
    routes/auth.js          — register/login/logout/me
    routes/profile.js       — PATCH профиля
    utils/jwt.js             — подпись/проверка JWT
    utils/referralCode.js     — генерация LEX-XXXXXX (тот же формат, что был на фронтенде)
    utils/asyncHandler.js      — обёртка для async-роутов (Express 4 сам не ловит их ошибки)
```
