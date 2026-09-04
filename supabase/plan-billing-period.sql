-- LexPrep — Supabase migration: период оплаты подписки (помесячно/год).
-- Выполнить один раз в SQL Editor, ПОСЛЕ profiles.sql.
--
-- Пока на сайте нет реального платёжного шлюза (оплата годовой/месячной
-- подписки), период выставляется вручную администратором вместе с
-- тарифом и сроком (см. admin.js "Тариф" / LexPrepApi.adminGrantSubscription).
-- Значение используется на фронтенде только для одного: у пользователей
-- с годовой оплатой в тренажёре включается "продвинутый" ИИ-консультант
-- (другая кнопка/оформление) вместо обычного — см. plan.js/app.js.

alter table public.profiles
  add column if not exists plan_billing_period text not null default 'monthly'
    check (plan_billing_period in ('monthly', 'annual'));

-- Тот же триггер прав, что в moderator.sql (public.enforce_profile_update_permissions),
-- но с добавленным plan_billing_period в список полей, которые обычный
-- пользователь/модератор не могут поменять себе сами (та же привилегия,
-- что и у plan_tier/plan_expires_at — меняет только админ).
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
  new.referral_code := old.referral_code;
  new.email := old.email;
  new.id := old.id;
  new.created_at := old.created_at;

  return new;
end;
$$;
