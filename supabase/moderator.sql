-- LexPrep — Supabase migration: права модератора + модерация
-- пользовательских тестов и статей.
-- Выполнить один раз в SQL Editor, ПОСЛЕ admin.sql и support-suggestions.sql.
--
-- Модератор (profiles.is_moderator = true) может:
--   - банить/разбанивать пользователей, менять им имя и аватар
--   - начислять монеты, но не больше +250 за одно начисление (проверяется
--     и в триггере ниже, и дополнительно в moderator.js на клиенте)
--   - отвечать на тикеты поддержки и предложения (те же таблицы/политики,
--     что уже использует админ — просто добавляем OR is_moderator())
--   - одобрять/отклонять пользовательские тесты и статьи перед публикацией
-- Модератор НЕ может: менять тариф подписки (plan_tier/plan_expires_at),
-- выдавать/снимать права админа или модератора, удалять аккаунты.

alter table public.profiles
  add column if not exists is_moderator boolean not null default false;

create or replace function public.is_moderator()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_moderator from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "Moderators can view all profiles" on public.profiles;
create policy "Moderators can view all profiles"
  on public.profiles for select
  using (public.is_moderator());

drop policy if exists "Moderators can update any profile" on public.profiles;
create policy "Moderators can update any profile"
  on public.profiles for update
  using (public.is_moderator());

-- Расширяем триггер прав из admin.sql: полноправны только админы, у
-- модераторов через свой UPDATE проходят только имя/аватар/бан/бонусные
-- монеты (и монеты — не больше +250 за одно обновление), тариф и
-- админские/модераторские флаги других людей менять не могут.
create or replace function public.enforce_profile_update_permissions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if public.is_moderator() then
    new.is_admin := old.is_admin;
    new.is_moderator := old.is_moderator;
    new.plan_tier := old.plan_tier;
    new.plan_expires_at := old.plan_expires_at;
    new.referral_code := old.referral_code;
    new.email := old.email;
    new.id := old.id;
    new.created_at := old.created_at;
    if new.bonus_coins - old.bonus_coins > 250 then
      new.bonus_coins := old.bonus_coins + 250;
    end if;
    return new;
  end if;

  new.is_admin := old.is_admin;
  new.is_moderator := old.is_moderator;
  new.is_banned := old.is_banned;
  new.ban_reason := old.ban_reason;
  new.bonus_coins := old.bonus_coins;
  new.plan_tier := old.plan_tier;
  new.plan_expires_at := old.plan_expires_at;
  new.referral_code := old.referral_code;
  new.email := old.email;
  new.id := old.id;
  new.created_at := old.created_at;

  return new;
end;
$$;

-- Модераторы тоже видят и отвечают на тикеты/предложения (в дополнение
-- к уже существующим политикам админа из support-suggestions.sql).
drop policy if exists "Moderators can view all tickets" on public.support_tickets;
create policy "Moderators can view all tickets"
  on public.support_tickets for select
  using (public.is_moderator());

drop policy if exists "Moderators can update tickets" on public.support_tickets;
create policy "Moderators can update tickets"
  on public.support_tickets for update
  using (public.is_moderator());

drop policy if exists "Moderators can update suggestions" on public.suggestions;
create policy "Moderators can update suggestions"
  on public.suggestions for update
  using (public.is_moderator());

-- ---------------------------------------------------------------------
-- Пользовательские тесты — раньше жили только в localStorage создателя,
-- теперь настоящая таблица с модерацией: пользователь отправляет тест
-- на проверку (status = 'pending'), модератор/админ одобряет его
-- (status = 'published', виден всем в теме) или отклоняет ('rejected',
-- виден только автору вместе с комментарием).

create table if not exists public.user_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  discipline_id text not null,
  topic_id text not null,
  title text not null check (char_length(title) between 8 and 200),
  questions jsonb not null,
  -- имя автора на момент публикации, а не живой join на profiles: обычный
  -- пользователь по RLS не видит чужие profiles, а каталог тестов должен
  -- показывать автора всем, не только модераторам
  author_name text not null,
  author_level integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  moderator_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.user_tests enable row level security;

drop policy if exists "Anyone authenticated can view published tests" on public.user_tests;
create policy "Anyone authenticated can view published tests"
  on public.user_tests for select
  using (status = 'published' or auth.uid() = user_id or public.is_admin() or public.is_moderator());

drop policy if exists "Users can create own tests" on public.user_tests;
create policy "Users can create own tests"
  on public.user_tests for insert
  with check (auth.uid() = user_id);

drop policy if exists "Moderators can review tests" on public.user_tests;
create policy "Moderators can review tests"
  on public.user_tests for update
  using (public.is_admin() or public.is_moderator());

-- ---------------------------------------------------------------------
-- Пользовательские статьи — та же схема модерации, что и у тестов.

create table if not exists public.user_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  title text not null check (char_length(title) between 10 and 200),
  excerpt text not null check (char_length(excerpt) between 30 and 500),
  body text not null,
  read_time integer not null default 1,
  author_name text not null,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  moderator_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.user_articles enable row level security;

drop policy if exists "Anyone authenticated can view published articles" on public.user_articles;
create policy "Anyone authenticated can view published articles"
  on public.user_articles for select
  using (status = 'published' or auth.uid() = user_id or public.is_admin() or public.is_moderator());

drop policy if exists "Users can create own articles" on public.user_articles;
create policy "Users can create own articles"
  on public.user_articles for insert
  with check (auth.uid() = user_id);

drop policy if exists "Moderators can review articles" on public.user_articles;
create policy "Moderators can review articles"
  on public.user_articles for update
  using (public.is_admin() or public.is_moderator());

-- ---------------------------------------------------------------------
-- Вьюхи с email автора для очереди модерации — имя уже денормализовано
-- в author_name на самой таблице (см. выше), а email виден только
-- модератору/админу через RLS profiles, поэтому добавляем его join'ом
-- отдельным полем (не переопределяя author_name, чтобы не было двух
-- одноимённых колонок в результате).

drop view if exists public.user_tests_with_author;
create view public.user_tests_with_author
  with (security_invoker = true)
as
select t.*, p.email as author_email
from public.user_tests t
left join public.profiles p on p.id = t.user_id;

drop view if exists public.user_articles_with_author;
create view public.user_articles_with_author
  with (security_invoker = true)
as
select a.*, p.email as author_email
from public.user_articles a
left join public.profiles p on p.id = a.user_id;
