-- LexPrep — настоящий счётчик «N онлайн» в шапке сайта. Выполнить один раз:
--   curl -s https://raw.githubusercontent.com/ninetybtw/lpesh/main/supabase/online.sql | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
--   docker restart supabase-rest
--
-- Раньше в шапке было случайное число (заглушка). Теперь вошедший
-- пользователь раз в пару минут отмечается через presence_ping(), а
-- online_count() считает, сколько человек отмечались за последние 5 минут.
-- Гости не считаются. Чужие отметки никто не видит — только общее число.

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now()
);

alter table public.user_presence enable row level security;
-- Политик нет намеренно: читать и писать таблицу можно только через
-- функции ниже.

create index if not exists user_presence_last_seen_idx on public.user_presence(last_seen);

create or replace function public.presence_ping()
returns void
language sql
security definer set search_path = public
as $$
  insert into public.user_presence (user_id, last_seen)
  select auth.uid(), now()
  where auth.uid() is not null
  on conflict (user_id) do update
    set last_seen = excluded.last_seen
    where public.user_presence.last_seen < now() - interval '30 seconds';
$$;

create or replace function public.online_count()
returns integer
language sql
stable
security definer set search_path = public
as $$
  select count(*)::integer from public.user_presence
  where last_seen > now() - interval '5 minutes';
$$;

revoke all on function public.presence_ping() from public, anon;
grant execute on function public.presence_ping() to authenticated;
revoke all on function public.online_count() from public;
grant execute on function public.online_count() to anon, authenticated;

notify pgrst, 'reload schema';
