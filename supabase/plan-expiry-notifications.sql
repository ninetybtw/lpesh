-- LexPrep — Supabase migration: флаги "уже напомнили об истечении тарифа".
-- Выполнить один раз в SQL Editor, ПОСЛЕ payments-downgrade.sql.
--
-- payments-autocharge (уже вызывается ежесуточным системным cron) шлёт
-- уведомление за 3 дня и за 1 день до истечения платного тарифа. Эти два
-- булевых поля не дают отправить одно и то же напоминание дважды за один
-- и тот же период — сбрасываются в false при продлении/оплате тарифа
-- (см. payments-notification), так что для новой даты истечения
-- напоминания сработают заново.

alter table public.profiles
  add column if not exists plan_expiry_notice_3d_sent boolean not null default false,
  add column if not exists plan_expiry_notice_1d_sent boolean not null default false;

-- Тот же триггер прав — новые поля туда же, куда и остальные plan_*
-- (обычный пользователь не может выставить их себе напрямую, только через
-- service_role в payments-notification/payments-autocharge).
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
    new.plan_expiry_notice_3d_sent := old.plan_expiry_notice_3d_sent;
    new.plan_expiry_notice_1d_sent := old.plan_expiry_notice_1d_sent;
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
  new.plan_expiry_notice_3d_sent := old.plan_expiry_notice_3d_sent;
  new.plan_expiry_notice_1d_sent := old.plan_expiry_notice_1d_sent;
  new.referral_code := old.referral_code;
  new.email := old.email;
  new.id := old.id;
  new.created_at := old.created_at;

  return new;
end;
$$;
