-- LexPrep — Supabase migration: докупленные в магазине запросы к
-- ИИ-консультанту сверх дневного лимита тарифа.
-- Выполнить один раз в SQL Editor, ПОСЛЕ ai-consultant.sql.
--
-- Раньше "3 запроса ИИ-консультанту" в магазине (shop.js) писались
-- только в localStorage-инвентарь браузера, а реальный дневной лимит
-- проверяется исключительно на сервере, в Edge Function ai-consultant
-- (см. supabase/functions/ai-consultant/index.ts) — она ничего не знала
-- про этот локальный инвентарь, поэтому покупка не давала эффекта.
-- Теперь "лишние" запросы хранятся здесь же, в профиле, и Edge Function
-- сама их учитывает и списывает.

alter table public.profiles
  add column if not exists ai_extra_requests integer not null default 0;

-- Отдельная RLS-политика не нужна: колонка не входит в список
-- "привилегированных" полей в enforce_profile_update_permissions
-- (см. admin.sql/moderator.sql), поэтому уже разрешённый обычному
-- пользователю UPDATE своей же строки (profiles.sql) пропускает её
-- без изменений — ровно так же, как name/avatar_url.
