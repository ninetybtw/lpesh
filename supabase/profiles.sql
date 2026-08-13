-- LexPrep — Supabase migration: профиль пользователя.
--
-- Выполнить один раз в Supabase Dashboard → SQL Editor (Project →
-- SQL Editor → New query → вставить целиком → Run).
--
-- auth.users управляется самим Supabase Auth — туда ничего руками не
-- пишем. Имя/аватар/промокод храним в отдельной public.profiles,
-- привязанной к auth.users по id. Строка создаётся автоматически
-- триггером при регистрации.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  avatar_url text,
  referral_code text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Тот же формат кода, что раньше генерировался на фронтенде:
-- LEX-XXXXXX без символов, которые легко перепутать (0/O, 1/I).
create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  code_taken boolean;
begin
  loop
    code := 'LEX-';
    for i in 1..6 loop
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;
    select exists(select 1 from public.profiles where referral_code = code) into code_taken;
    exit when not code_taken;
  end loop;
  return code;
end;
$$;

-- security definer — нужен, чтобы вставка в profiles прошла до того,
-- как у пользователя вообще появится собственная сессия (RLS иначе
-- заблокировал бы insert).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    public.generate_referral_code()
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- updated_at обновляется сам при любом UPDATE
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();
