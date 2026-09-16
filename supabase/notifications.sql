-- LexPrep — таблица уведомлений пользователя (колокольчик в шапке).
-- Выполнить один раз в SQL Editor.
--
-- Обычные уведомления (новый уровень, куплена подписка, топ в рейтинге и
-- т.п.) вставляет сам клиент через обычный insert от своего имени —
-- RLS разрешает только user_id = auth.uid(), так что подделать чужое
-- уведомление нельзя, а спам себе самому не представляет интереса.
-- Массовая рассылка "всем" (админ пишет объявление) идёт через отдельную
-- security definer RPC notifications_broadcast — обычный insert с чужим
-- user_id или "для всех" клиенту не даёт RLS.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications_insert_own" on public.notifications;
create policy "notifications_insert_own" on public.notifications
  for insert with check (
    auth.uid() = user_id
    or coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true'
  );

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Массовая рассылка "всем пользователям" — доступна только
-- админам/модераторам (проверяется здесь же, а не только на фронтенде).
create or replace function public.notifications_broadcast(
  p_title text,
  p_body text,
  p_link text default null
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_is_staff boolean;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select (is_admin or is_moderator) into v_is_staff
  from public.profiles where id = auth.uid();

  if not coalesce(v_is_staff, false) then
    raise exception 'not_allowed';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);

  insert into public.notifications (user_id, type, title, body, link)
  select id, 'announcement', p_title, p_body, p_link
  from auth.users;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.notifications_broadcast(text, text, text) to authenticated;
