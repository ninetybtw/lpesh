-- LexPrep — Supabase migration: права администратора.
-- Выполнить один раз в SQL Editor, ПОСЛЕ profiles.sql.
--
-- Добавляет:
--   - is_admin / is_banned / ban_reason на profiles
--   - bonus_coins и plan_tier/plan_expires_at — серверная часть валюты и
--     тарифа, которую админ может выдавать; фронтенд прибавляет их к
--     локальному прогрессу при синхронизации профиля
--   - email на profiles (нужен для списка пользователей в админке —
--     auth.users напрямую с anon-ключом не читается)
--   - is_admin() — security definer функция, чтобы RLS-политики могли
--     проверять права без риска рекурсии
--   - триггер, запрещающий обычным пользователям менять админские поля
--     через свой же UPDATE (auth.uid() = id всё ещё даёт им право
--     обновить СВОЮ строку — эта функция обрубает, что именно они могут
--     в ней поменять)

alter table public.profiles
  add column if not exists email text,
  add column if not exists is_admin boolean not null default false,
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists bonus_coins integer not null default 0,
  add column if not exists plan_tier text not null default 'basic',
  add column if not exists plan_expires_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_plan_tier_check;
alter table public.profiles
  add constraint profiles_plan_tier_check check (plan_tier in ('basic', 'pro', 'max'));

-- backfill email для уже существующих профилей (созданных до этого поля)
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());

drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update
  using (public.is_admin());

-- email тоже пишем в момент регистрации
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    public.generate_referral_code()
  );
  return new;
end;
$$;

-- обычный пользователь через свой UPDATE не может выдать себе админку,
-- бан снять/поставить, начислить монеты или подписку — эти поля
-- откатываются к прежним значениям, если менял не админ
create or replace function public.enforce_profile_update_permissions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- auth.uid() пустой, когда запрос выполняется не через обычный API-вызов
  -- от имени пользователя (например, прямо в SQL Editor от postgres) —
  -- такой контекст по умолчанию доверенный, иначе даже сам себя не
  -- назначить первым админом.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  new.is_admin := old.is_admin;
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

drop trigger if exists enforce_profile_update_permissions on public.profiles;
create trigger enforce_profile_update_permissions
  before update on public.profiles
  for each row execute procedure public.enforce_profile_update_permissions();

-- ---------------------------------------------------------------------
-- Первого админа никто, включая владельца строки, назначить через UI не
-- может (триггер выше это специально блокирует) — только руками здесь,
-- один раз. Дальше уже можно выдавать/снимать права другим админам
-- через саму админку (обновляет is_admin у чужого профиля, раз вызывающий
-- уже админ).
--
-- Тестовый аккаунт (уже зарегистрирован, можно сразу логиниться на
-- /auth.html): admin.test@lexprep.local / AdminLexPrep2026!
update public.profiles set is_admin = true where email = 'admin.test@lexprep.local';
