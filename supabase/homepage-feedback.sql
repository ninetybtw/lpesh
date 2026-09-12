-- LexPrep — Supabase migration: обращения из формы "Обратная связь" на
-- главной странице (index.html#feedback). Выполнить один раз в SQL
-- Editor, ПОСЛЕ admin.sql и moderator.sql (нужны public.is_admin() и
-- public.is_moderator()).
--
-- В отличие от support_tickets (только для залогиненных, привязаны к
-- user_id), эта форма открыта гостям — имя/email вводятся вручную, без
-- аккаунта. Поэтому insert разрешён всем (anon-ключом), а просмотр и
-- смена статуса — только админам и модераторам.

create table if not exists public.homepage_feedback (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200),
  message text not null check (char_length(message) between 5 and 4000),
  status text not null default 'new' check (status in ('new', 'read', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.homepage_feedback enable row level security;

drop policy if exists "Anyone can submit feedback" on public.homepage_feedback;
create policy "Anyone can submit feedback"
  on public.homepage_feedback for insert
  with check (true);

drop policy if exists "Admins and moderators can view feedback" on public.homepage_feedback;
create policy "Admins and moderators can view feedback"
  on public.homepage_feedback for select
  using (public.is_admin() or public.is_moderator());

drop policy if exists "Admins and moderators can update feedback" on public.homepage_feedback;
create policy "Admins and moderators can update feedback"
  on public.homepage_feedback for update
  using (public.is_admin() or public.is_moderator());
