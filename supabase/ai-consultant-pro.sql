-- LexPrep — Supabase migration: серверный учёт использования "продвинутого"
-- ИИ-консультанта (доступен только тем, кто оплатил подписку сразу на
-- год — profiles.plan_billing_period = 'annual', см. plan-billing-period.sql).
-- Выполнить один раз в SQL Editor, ПОСЛЕ ai-consultant.sql и
-- plan-billing-period.sql.
--
-- Отдельная таблица, а не переиспользование ai_consultant_usage: у
-- продвинутого консультанта своя дневная квота, не расходующая обычную.
-- Сам вызов NVIDIA API и проверка тарифа/периода — в Edge Function
-- ai-consultant-pro (supabase/functions/ai-consultant-pro/index.ts) через
-- service_role; обычному пользователю insert/update не даём — иначе можно
-- было бы обнулить себе счётчик и обойти лимит.

create table if not exists public.ai_consultant_pro_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_consultant_pro_usage enable row level security;

drop policy if exists "Users can view own ai pro usage" on public.ai_consultant_pro_usage;
create policy "Users can view own ai pro usage"
  on public.ai_consultant_pro_usage for select
  using (auth.uid() = user_id);
