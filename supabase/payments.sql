-- LexPrep — Supabase migration: реальная оплата подписки через Т-Кассу.
-- Выполнить один раз в SQL Editor, ПОСЛЕ profiles.sql/admin.sql и
-- plan-billing-period.sql.
--
-- Вся работа с деньгами (создание платежа, обработка вебхука банка,
-- автосписание) идёт через service_role в Edge Functions
-- (payments-init/payments-notification/payments-autocharge/payments-cancel)
-- — обычному пользователю запись в payments и правку своих plan_tier/
-- plan_expires_at/plan_billing_period мы не даём (иначе можно было бы
-- выдать себе подписку без оплаты).

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_tier text not null check (plan_tier in ('pro', 'max')),
  billing_period text not null check (billing_period in ('monthly', 'annual')),
  amount_kopecks integer not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed', 'canceled', 'refunded')),
  tbank_payment_id text,
  rebill_id text,
  is_auto_charge boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists payments_user_id_idx on public.payments(user_id);
create index if not exists payments_tbank_payment_id_idx on public.payments(tbank_payment_id);

alter table public.payments enable row level security;

drop policy if exists "Users can view own payments" on public.payments;
create policy "Users can view own payments"
  on public.payments for select
  using (auth.uid() = user_id);

-- Карта, привязанная к подписке через первый рекуррентный платёж
-- (RebillId из уведомления банка), и признак "продлевать автоматически" —
-- пользователь может отключить в профиле (payments-cancel), но включить
-- обратно можно только оплатив заново (см. payments-init).
alter table public.profiles
  add column if not exists tbank_rebill_id text,
  add column if not exists plan_auto_renew boolean not null default false;

-- Тот же триггер прав, что в plan-billing-period.sql, — добавляем новые
-- поля в список того, что обычный пользователь/модератор не могут
-- поменять себе сами напрямую через update profiles (только через
-- сервисные Edge Functions с service_role, у которых auth.uid() is null).
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
  new.referral_code := old.referral_code;
  new.email := old.email;
  new.id := old.id;
  new.created_at := old.created_at;

  return new;
end;
$$;
