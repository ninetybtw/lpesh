-- LexPrep — Supabase migration: отложенное понижение тарифа.
-- Выполнить один раз в SQL Editor, ПОСЛЕ payments.sql.
--
-- Раньше клик на более дешёвый тариф сразу списывал деньги и сразу же
-- подменял profiles.plan_tier — если у пользователя был оплаченный
-- "Максимум" до конца месяца, а он решал перейти на "Про", он терял
-- неиспользованные дни "Максимума" и платил за "Про" ещё раз поверх
-- уже оплаченного периода. Теперь понижение тарифа не требует оплаты
-- прямо сейчас — пользователь просто планирует смену, она применяется
-- сама через payments-autocharge, когда текущий (более дорогой) период
-- истечёт.

alter table public.profiles
  add column if not exists pending_plan_tier text check (pending_plan_tier in ('basic', 'pro', 'max')),
  add column if not exists pending_plan_billing_period text check (pending_plan_billing_period in ('monthly', 'annual'));

-- Тот же триггер прав — новые поля туда же, куда и остальные plan_*
-- (обычный пользователь не может выставить их себе напрямую через update
-- profiles, только через service_role в Edge Function payments-schedule-downgrade).
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
    new.plan_billing_period := old.plan_billing_period;
    new.tbank_rebill_id := old.tbank_rebill_id;
    new.plan_auto_renew := old.plan_auto_renew;
    new.pending_plan_tier := old.pending_plan_tier;
    new.pending_plan_billing_period := old.pending_plan_billing_period;
    new.referral_code := old.referral_code;
    new.email := old.email;
    new.id := old.id;
    new.created_at := old.created_at;
    if new.bonus_coins - old.bonus_coins > 1000 then
      new.bonus_coins := old.bonus_coins + 1000;
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
  new.plan_billing_period := old.plan_billing_period;
  new.tbank_rebill_id := old.tbank_rebill_id;
  new.plan_auto_renew := old.plan_auto_renew;
  new.pending_plan_tier := old.pending_plan_tier;
  new.pending_plan_billing_period := old.pending_plan_billing_period;
  new.referral_code := old.referral_code;
  new.email := old.email;
  new.id := old.id;
  new.created_at := old.created_at;

  return new;
end;
$$;
