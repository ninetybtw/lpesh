-- LexPrep — лимит устройств на аккаунт: не больше 3 одновременно.
-- Выполнить один раз в SQL Editor, ПОСЛЕ profiles.sql.
--
-- Как работает
-- ------------
-- GoTrue (Supabase Auth) перед выдачей токена при входе вызывает
-- public.lexprep_device_limit_hook (Custom Access Token Hook). Хук
-- считает активные сессии пользователя в auth.sessions (кроме
-- создаваемой сейчас) и, если их уже 3, отказывает во входе с понятным
-- сообщением — токен не выдаётся, новая сессия не сохраняется.
--
--   • «Активная» сессия — та, что обновлялась за последние 30 дней.
--     Брошенный телефон перестаёт занимать место сам через месяц.
--   • Повторный вход с того же браузера (тот же User-Agent) не занимает
--     новое место — старая сессия этого браузера заменяется. Иначе
--     человек, почистивший куки, сам себя заблокировал бы.
--   • Восстановление пароля по коду из письма — «аварийный выход»: такой
--     вход проходит всегда и завершает все остальные сессии.
--   • Продление токена (token_refresh) хук не трогает — уже вошедшие
--     устройства работают как раньше.
--   • Админы не ограничиваются.
--   • Любая ошибка внутри хука пропускает вход (fail-open): сбой в этой
--     функции не должен закрыть сайт для всех.
--
-- Выйти с лишнего устройства: Профиль → Настройки → «Устройства»
-- (RPC my_devices / revoke_my_device ниже) или обычным «Выйти» на нём.
--
-- Подключение хука (после выполнения этого файла) — в docker-compose.yml
-- у сервиса auth добавить в environment:
--   GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: "true"
--   GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI: "pg-functions://postgres/public/lexprep_device_limit_hook"
-- и применить: docker compose up -d auth
-- Отключить: ENABLED "false" (или убрать строки) и снова docker compose up -d auth.

create or replace function public.lexprep_device_limit_hook(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_limit constant integer := 3;
  v_user uuid;
  v_session uuid;
  v_method text;
  v_ua text;
  v_is_admin boolean := false;
  v_active integer := 0;
begin
  begin
    v_user := nullif(event->>'user_id', '')::uuid;
    v_session := nullif(event->'claims'->>'session_id', '')::uuid;
    v_method := coalesce(event->>'authentication_method', '');

    if v_user is null or v_method = 'token_refresh' then
      return event;
    end if;

    -- Вход по коду из письма (verifyOtp) GoTrue помечает как 'otp' — и
    -- восстановление пароля, и подтверждение регистрации. У нового
    -- пользователя других сессий нет, так что для регистрации это ничего
    -- не меняет, а для восстановления — тот самый «аварийный выход».
    if v_method in ('otp', 'recovery', 'magiclink') then
      delete from auth.sessions
      where user_id = v_user and id is distinct from v_session;
      return event;
    end if;

    begin
      select coalesce(p.is_admin, false) into v_is_admin
      from public.profiles p where p.id = v_user;
    exception when others then
      v_is_admin := false;
    end;
    if coalesce(v_is_admin, false) then
      return event;
    end if;

    begin
      select s.user_agent into v_ua from auth.sessions s where s.id = v_session;
    exception when others then
      v_ua := null;
    end;
    if coalesce(v_ua, '') <> '' then
      delete from auth.sessions
      where user_id = v_user and id is distinct from v_session and user_agent = v_ua;
    end if;

    begin
      select count(*) into v_active
      from auth.sessions s
      where s.user_id = v_user
        and s.id is distinct from v_session
        and (s.not_after is null or s.not_after > now())
        and coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) > now() - interval '30 days';
    exception when others then
      select count(*) into v_active
      from auth.sessions s
      where s.user_id = v_user
        and s.id is distinct from v_session
        and coalesce(s.updated_at, s.created_at) > now() - interval '30 days';
    end;

    if v_active >= v_limit then
      delete from auth.sessions where id = v_session;
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 403,
        'message', 'Аккаунт уже открыт на ' || v_limit || ' устройствах — это максимум. '
          || 'Выйдите из аккаунта на одном из них (Профиль → Настройки → Устройства) и войдите снова. '
          || 'Нет доступа к тем устройствам — восстановите пароль: это завершит все остальные сессии.'
      ));
    end if;

    return event;
  exception when others then
    return event;
  end;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.lexprep_device_limit_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.lexprep_device_limit_hook(jsonb) from authenticated, anon, public;

grant select on table public.profiles to supabase_auth_admin;
drop policy if exists "Auth admin reads profiles for device limit" on public.profiles;
create policy "Auth admin reads profiles for device limit"
  on public.profiles for select
  to supabase_auth_admin
  using (true);

-- Список своих устройств для профиля. auth.sessions из API не видна,
-- поэтому — security definer и только строки самого пользователя.
create or replace function public.my_devices()
returns table (
  id uuid,
  created_at timestamptz,
  last_active_at timestamptz,
  user_agent text,
  ip text,
  is_current boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    s.id,
    s.created_at,
    coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) as last_active_at,
    s.user_agent,
    host(s.ip) as ip,
    s.id = nullif(auth.jwt()->>'session_id', '')::uuid as is_current
  from auth.sessions s
  where s.user_id = auth.uid()
    and (s.not_after is null or s.not_after > now())
    and coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) > now() - interval '30 days'
  order by is_current desc, last_active_at desc;
$$;

-- Завершить одну из своих сессий. Уже выданный токен того устройства
-- доживает до истечения (до часа), продлить его оно уже не сможет.
create or replace function public.revoke_my_device(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from auth.sessions where id = p_session_id and user_id = auth.uid();
  return found;
end;
$$;

revoke all on function public.my_devices() from public, anon;
revoke all on function public.revoke_my_device(uuid) from public, anon;
grant execute on function public.my_devices() to authenticated;
grant execute on function public.revoke_my_device(uuid) to authenticated;

notify pgrst, 'reload schema';
