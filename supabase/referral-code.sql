-- LexPrep — Supabase migration: пользователь может сам сменить свой
-- промокод. Выполнить один раз в SQL Editor, ПОСЛЕ admin.sql.
--
-- До этого referral_code был в списке полей, которые
-- enforce_profile_update_permissions() откатывал у обычных
-- пользователей — здесь убираем именно его из списка (остальные
-- админские поля по-прежнему защищены) и добавляем валидацию формата,
-- чтобы не завести в базу что попало.

alter table public.profiles
  drop constraint if exists profiles_referral_code_format;
alter table public.profiles
  add constraint profiles_referral_code_format
  check (referral_code ~ '^[A-Z0-9](-?[A-Z0-9]){2,19}$');

create or replace function public.enforce_profile_update_permissions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.referral_code is distinct from old.referral_code then
    new.referral_code := upper(trim(new.referral_code));
    if new.referral_code !~ '^[A-Z0-9](-?[A-Z0-9]){2,19}$' then
      raise exception 'invalid_referral_code' using
        detail = 'Промокод: 3-20 символов, латинские буквы, цифры и дефис, не подряд.';
    end if;
  end if;

  new.is_admin := old.is_admin;
  new.is_banned := old.is_banned;
  new.ban_reason := old.ban_reason;
  new.bonus_coins := old.bonus_coins;
  new.plan_tier := old.plan_tier;
  new.plan_expires_at := old.plan_expires_at;
  new.email := old.email;
  new.id := old.id;
  new.created_at := old.created_at;

  return new;
end;
$$;
