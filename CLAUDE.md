# LexPrep — заметки для Claude

Платформа подготовки студентов-юристов: тренажёр по темам (конспекты, тесты,
карточки), экзамен, библиотека билетов, дуэли и турниры, ИИ-консультант,
платная подписка. Сайт — lexprep.ru.

**Репозиторий публичный.** Никаких токенов, ключей service_role, паролей,
email или id пользователей, IP сервера и админов в коммиты не класть.
anon-ключ в `api.js` — публичный по замыслу, это нормально.

## Общение

- Владелец пишет по-русски и отвечать надо по-русски.
- Он не разработчик: команды для сервера давать готовыми к вставке, по шагам,
  и всегда явно писать, **куда** вставлять — в терминал сервера
  (`root@mercy:~#`) или в SQL Editor в Studio. Путает их — это частая ошибка.
- Доступа к серверу у Claude нет. Всё серверное делает владелец по инструкции.

## Архитектура

- **Фронтенд** — статические HTML/JS/CSS без сборки, GitHub Pages из ветки
  `main` (файл `CNAME`). Чистые URL (`/app`, `/profile`…).
- **Бэкенд** — self-hosted Supabase на api.lexprep.ru: nginx на хосте → Kong →
  PostgREST / GoTrue / edge-функции. Docker-compose в `/root/supabase/docker`,
  контейнеры `supabase-db`, `supabase-rest`, `supabase-auth`,
  `supabase-edge-functions`, `supabase-kong`.
- `api.js` — единственная обёртка над Supabase (`LexPrepApi`), все запросы
  к бэкенду идут через неё. `friendlyError` переводит ошибки на русский.
- `content-loader.js` грузит дисциплины/темы/тесты из базы (кэш в IndexedDB,
  ключ `v2`; перекачивает, только если изменилась `content_version()` из
  `supabase/content-version.sql`). Конспект хранится как markdown
  (`theoryMd`), `topic.theory` — ленивый геттер, HTML строится при открытии;
  `lexprepConvertQuiz` — единая точка конвертации тестов, там же
  перемешивание вариантов ответа.
- Локальный прогресс (опыт, монеты, карточки, статистика, заметки, тариф за
  монеты, история ИИ и др.) живёт в localStorage и привязан к аккаунту через
  `account-scope.js` (подключён первым в `<head>` всех страниц): при смене
  пользователя данные прежнего откладываются в `lexprep_stash:<id>`.
  **Новый ключ с данными пользователя — добавить в `PER_USER_KEYS`** (и в
  `SYNC_KEYS`, если он должен совпадать на всех устройствах). Тот же файл
  синхронизирует прогресс между устройствами через таблицу `user_progress`
  (`supabase/progress-sync.sql`): карточки/тесты/экзамены/конспекты
  объединяются, монеты — по максимуму, остальное — по свежести (время
  изменения ключей в `lexprep_sync_mtimes`). Опыт на сервер (`syncXp`)
  пишется только в сторону увеличения.
- `plan.js` — действующий тариф: из `profiles.plan_tier/plan_expires_at`
  (кэш в `localStorage.lexprep_user`, обновляется `script.js` через `me()`
  при каждой загрузке страницы) и локального тарифа из магазина.

## Как вносить изменения

- Работаем прямо в `main`: локальная ветка может называться иначе, пушить
  `git push origin HEAD:main`.
- Меняешь JS/CSS — подними `?v=…` у подключения этого файла во **всех**
  `*.html` (иначе у пользователей останется старый кэш).
- Сообщения коммитов — по-русски, по существу.
- Проверка JS: `node --check файл.js`; инлайн-скрипты из HTML — вытащить и
  проверить так же.

## База данных

- Миграции — `supabase/*.sql`, применяются вручную, каждая с инструкцией в
  шапке. **Studio SQL Editor режет длинные вставки** и выполняет файл с
  середины (`syntax error at or near …`). Надёжный способ — из терминала
  сервера:
  ```bash
  curl -s https://raw.githubusercontent.com/ninetybtw/lpesh/main/supabase/<файл>.sql | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
  docker restart supabase-rest
  ```
  После DDL PostgREST надо перезапустить (или `notify pgrst, 'reload schema'`),
  иначе новые функции дают 404.
- SQL можно проверить локально: `apt-get install postgresql`, initdb в
  `/var/tmp`, заглушки `auth.users`, `auth.uid()` (через `current_setting`),
  `profiles` — так воспроизводили и чинили промокоды.
- **Триггер `enforce_profile_update_permissions` на `profiles`** откатывает
  обычному пользователю серверные поля (тариф, монеты, рейтинг, админку…).
  Серверные RPC пишут в эти поля, ставя
  `set_config('lexprep.trusted_rpc', 'true', true)`. Актуальная версия
  триггера — в `supabase/trial.sql`. Если новая миграция переписывает
  триггер, бери её за основу и **не теряй проверку trusted_rpc** — однажды
  её потеряли, и промокоды молча перестали выдавать подписку и монеты.
- Новое защищённое поле в `profiles` — добавить в этот триггер.
- RLS на `pvp_duels` прячет чужие строки даже от админа; у
  `tournament_matches` нет delete-политики; FK без каскада
  (`pvp_duels.winner_id`, `tournament_matches.*`, `tournaments.winner_id`,
  `promo_codes.created_by`) мешают удалить пользователя. Реальную ошибку
  смотреть в `docker logs supabase-auth`.

## Edge-функции

Исходники в `supabase/functions/`. Выкладка — копированием на сервер:
```bash
cd /root/supabase/docker/volumes/functions
curl -s -o <имя>/index.ts https://raw.githubusercontent.com/ninetybtw/lpesh/main/supabase/functions/<имя>/index.ts
docker restart supabase-edge-functions
```
Оплата — Т-Касса (`payments-*`, `_shared/tbank.ts`), ИИ — GigaChat
(`ai-consultant*`, `_shared/gigachat.ts`).

ИИ-консультант умеет искать в интернете: инструмент `web_search`
(`_shared/websearch.ts`) через function calling GigaChat (`callGigaChat` с
`functions`). С переменными `YANDEX_SEARCH_API_KEY` и
`YANDEX_SEARCH_FOLDER_ID` в контейнере функций — Yandex Search API, без
них — поиск по русской Википедии.

## Промокоды

`supabase/promo-codes.sql` + `supabase/promo-fix.sql`. Типы: `subscription`
(сразу выдаёт тариф), `discount` (копится в `profiles.pending_discount_percent`,
`payments-init` уменьшает сумму первой оплаты, `payments-notification`
обнуляет после успешной оплаты), `coins`. Поле `audience`: `new` (аккаунт не
старше суток) / `existing` / `all`. «Удаление» в админке — `active = false`.

## Пробный период

`supabase/trial.sql`: «Про» на 14 дней за 1 ₽ для тех, кто ни разу не платил,
не брал пробный и без действующего платного тарифа (`trial_eligible()`).
`payments-init` с `{trial: true}` — платёж 1 ₽ с привязкой карты;
`payments-notification` включает 14 дней и ставит `plan_is_trial`,
`trial_used_at`; через 14 дней `payments-autocharge` списывает 600 ₽ за
месяц «Про». Условия описаны на главной (баннер в тарифах, FAQ), в профиле и
в оферте (раздел 5). Цены и лимиты на главной, в `profile.js`
(`PLAN_FEATURES`), `plan.js` и edge-функциях ИИ должны совпадать.

## Имена и email

- Имя/никнейм проверяется дважды: на сайте (`validation.js`,
  `checkDisplayName`) и в базе (`supabase/name-check.sql`,
  `lexprep_name_problem` + триггер на `profiles`). Мат (в т.ч. маскировка
  латиницей/цифрами/пробелами), оскорбления, служебные имена, бессмыслица.
  **Списки слов в двух местах должны совпадать.** При регистрации плохое
  имя не ломает вход — сервер подставляет «Студент XXXX»; админам можно всё.
- Email при регистрации: `checkEmailTypo` ловит несуществующие зоны (.con,
  .ry…) и опечатки в популярных доменах (gmial.com) — с кнопкой «Исправить».
- Колонка «Статус» в админке: `admin_users_auth_info()` — подтверждена ли
  почта кодом и последний вход.

## Сайт и поиск

- Служебные страницы (admin, moderator, profile, create-test,
  write-article) закрыты от индексации `<meta name="robots" content="noindex">`,
  в `robots.txt` их не перечисляем. В `sitemap.xml` — только страницы с
  содержимым для гостя (`/`, `/library`, `/article`, `/legal`, `/support`).
- Ссылки «Админка»/«Модерация» вставляет `script.js` (`syncStaffLinks`)
  только админам/модераторам; данные защищены RLS и проверками в RPC.
- Счётчик «онлайн» — настоящий (`supabase/online.sql`), без выдуманных цифр.
- Режим приложения («На экран Домой»): `viewport-fit=cover` + отступы
  `env(safe-area-inset-*)`, `theme-color` под тему, `sw.js` (только
  офлайн-страница `offline.html`, ничего не кэширует), окно-инструкция
  «Скачать приложение» на любой ссылке `[data-install-app]` (script.js).
- Тяжёлое грузить по требованию: jsPDF и шрифт для PDF подгружает `app.js`
  при нажатии «Скачать PDF»; `data.js` (демо-данные) — только на страницах,
  где используется `LEXPREP_DATA`.

## Библиотека билетов

Схема — `supabase/library.sql`: `library_collections` → `library_items`
(номер, заголовок, `part` — раздел) → `library_item_content` (`content_html`,
`footnotes` `[{n, text}]`, `images` — пути) + `library_assets` (картинки
base64, сопоставляются с `<img src>` по имени файла).

Загрузка новых сборников (присылают PDF/DOCX в rar/zip):
- Разбор — Python-скриптом во временной папке (PyMuPDF для PDF,
  python-docx для DOCX; DOCX обычно чище — стили Heading 1/2/3, списки,
  таблицы, сноски). Каждый сборник свёрстан по-своему, парсер пишется заново.
- Загрузка — upsert через REST от имени админа: владелец даёт свой
  access_token (в консоли браузера на сайте:
  `copy(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes('auth-token')))).access_token)`),
  живёт ~1 час. Заголовок `Prefer: resolution=merge-duplicates`. Контент —
  пачками по 2–3 строки, иначе nginx отвечает 413.
- id билетов: `<collection-id>-001`, сквозная нумерация.
- Перед загрузкой проверить, нет ли уже такого сборника
  (`library_collections`), и не дублировать.
- Что понимает `library.js` (санитайзер): обычные теги, `<pre>` для схем,
  таблицы, `<p style="margin-left:Npt">` (отступ), `<div class="callout
  law|note|warn">` (врезки с подписью), `<blockquote>` (рамка без подписи —
  задачи), `<mark>` и `<mark class="hl-g|hl-b|hl-r|hl-v|hl-s">` (цветные
  выделения), `<span class="c-blue">`, `<sup class="fn-ref">N</sup>` (сноски).
- В карточке сборника не показывать авторов и длинные перечни разделов.

Загружено (на 07.10.2026): гражданский процесс, административное право,
уголовный процесс, гражданское право (общая часть; обязательственное право),
ИГПЗС (две части), международное право, ТГП, муниципальное право, уголовное
право, ИОГП, трудовое право.

## Защита сервера

- `supabase/nginx/` — лимиты nginx по IP (весь API 20 r/s + всплеск,
  вход/регистрация 20 r/min, edge-функции 1 r/s, кроме уведомлений Т-Кассы)
  и jail fail2ban (бан на час, повторно — на сутки). На Ubuntu 24.04 jail
  должен читать файл (`backend = auto`), а не journald.
- Если владелец «не может зайти» — сначала проверить, не забанен ли он:
  `sudo fail2ban-client status nginx-limit-req`, разбан
  `sudo fail2ban-client unban --all`. Свой IP — в `ignoreip` jail и в
  `geo $lexprep_limit_exempt` в `/etc/nginx/conf.d/lexprep-limits.conf`.
- `supabase/device-limit.sql` — не больше 3 устройств на аккаунт (GoTrue
  Custom Access Token Hook, включён переменными
  `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*` в docker-compose). Вход по коду из
  письма (восстановление пароля) завершает остальные сессии; админы без
  лимита; при сбое хук пропускает вход. Отключить —
  `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: "false"` и
  `docker compose up -d auth`.
