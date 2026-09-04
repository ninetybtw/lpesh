-- LexPrep — Supabase migration: поддержка (тикеты) и предложения от
-- пользователей. Выполнить один раз в SQL Editor, ПОСЛЕ admin.sql.
--
-- support_tickets — обращения в поддержку: пользователь создаёт и видит
-- только свои, админ видит и отвечает на все (см. supabase/admin.sql —
-- переиспользуем public.is_admin()).
--
-- suggestions + suggestion_votes — предложения по изменениям/поправкам:
-- любой залогиненный видит все предложения и может проголосовать (один
-- голос на человека), статус/комментарий меняет только админ.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 3 and 120),
  message text not null check (char_length(message) between 5 and 4000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.support_tickets enable row level security;

drop policy if exists "Users can view own tickets" on public.support_tickets;
create policy "Users can view own tickets"
  on public.support_tickets for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can create own tickets" on public.support_tickets;
create policy "Users can create own tickets"
  on public.support_tickets for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can update tickets" on public.support_tickets;
create policy "Admins can update tickets"
  on public.support_tickets for update
  using (public.is_admin());

create or replace function public.set_ticket_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_support_tickets_updated_at on public.support_tickets;
create trigger set_support_tickets_updated_at
  before update on public.support_tickets
  for each row execute procedure public.set_ticket_updated_at();

-- ---------------------------------------------------------------------

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  message text not null check (char_length(message) between 5 and 4000),
  status text not null default 'new' check (status in ('new', 'reviewing', 'accepted', 'rejected')),
  admin_comment text,
  created_at timestamptz not null default now()
);

alter table public.suggestions enable row level security;

drop policy if exists "Anyone authenticated can view suggestions" on public.suggestions;
create policy "Anyone authenticated can view suggestions"
  on public.suggestions for select
  using (auth.uid() is not null);

drop policy if exists "Users can create own suggestions" on public.suggestions;
create policy "Users can create own suggestions"
  on public.suggestions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can update suggestions" on public.suggestions;
create policy "Admins can update suggestions"
  on public.suggestions for update
  using (public.is_admin());

create table if not exists public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);

alter table public.suggestion_votes enable row level security;

drop policy if exists "Anyone authenticated can view votes" on public.suggestion_votes;
create policy "Anyone authenticated can view votes"
  on public.suggestion_votes for select
  using (auth.uid() is not null);

drop policy if exists "Users can vote as themselves" on public.suggestion_votes;
create policy "Users can vote as themselves"
  on public.suggestion_votes for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove own vote" on public.suggestion_votes;
create policy "Users can remove own vote"
  on public.suggestion_votes for delete
  using (auth.uid() = user_id);

-- Вьюха с готовым числом голосов, чтобы фронтенд не считал агрегаты сам.
-- security_invoker — чтобы RLS проверялась по правам вызывающего, а не
-- владельца вьюхи (иначе в новых версиях Postgres вьюха по умолчанию
-- может обойти политики базовых таблиц).
drop view if exists public.suggestions_with_votes;
create view public.suggestions_with_votes
  with (security_invoker = true)
as
select
  s.*,
  coalesce(v.votes_count, 0) as votes_count
from public.suggestions s
left join (
  select suggestion_id, count(*) as votes_count
  from public.suggestion_votes
  group by suggestion_id
) v on v.suggestion_id = s.id;
