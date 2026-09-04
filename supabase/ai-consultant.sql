-- LexPrep — Supabase migration: серверный учёт использования ИИ-консультанта.
-- Выполнить один раз в SQL Editor, ПОСЛЕ duels.sql.
--
-- Сам вызов NVIDIA API и лимиты по тарифу (кто вообще может спрашивать,
-- сколько раз в день) считает Edge Function ai-consultant
-- (supabase/functions/ai-consultant/index.ts) через service_role — она
-- же пишет счётчик сюда. Обычному пользователю никакого insert/update
-- не даём: иначе можно было бы занулить себе счётчик и обойти лимит.

create table if not exists public.ai_consultant_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_consultant_usage enable row level security;

drop policy if exists "Users can view own ai usage" on public.ai_consultant_usage;
create policy "Users can view own ai usage"
  on public.ai_consultant_usage for select
  using (auth.uid() = user_id);
