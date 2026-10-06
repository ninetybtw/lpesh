-- LexPrep — починка промокодов + промокоды для любых пользователей +
-- скидка по промокоду при оплате. Выполнить один раз в SQL Editor, ПОСЛЕ
-- plan-expiry-notifications.sql и promo-codes.sql.
--
-- Что было сломано
-- ----------------
-- redeem_promo_code() выдаёт подписку/монеты обычным UPDATE profiles с
-- флагом lexprep.trusted_rpc. Триггер enforce_profile_update_permissions
-- раньше этот флаг пропускал (duels.sql), но поздние миграции
-- (payments.sql … plan-expiry-notifications.sql) переписали триггер без
-- этой проверки — и он молча откатывал plan_tier/plan_expires_at/
-- bonus_coins обратно. Код говорил «подписка выдана», а в профиле ничего
-- не менялось. Заодно потерялись: защита duel_rating от ручной правки и
-- возможность самому сменить свой реферальный код (referral-code.sql).
--
-- Новое
-- -----
--   promo_codes.audience — кому можно активировать подписку/скидку:
--     'new'      — только новым аккаунтам (не старше суток), как раньше;
--     'existing' — только уже существующим (старше суток);
--     'all'      — всем.
--   Монеты (coins) по-прежнему для всех.
--   Скидка: payments-init берёт profiles.pending_discount_percent и
--   уменьшает сумму первой оплаты; после успешной оплаты
--   payments-notification обнуляет скидку. Автопродление — по полной цене.

-- 1. Триггер прав на profiles: последняя версия + trusted_rpc + duel_rating
--    + pending_discount_percent + свой реферальный код с проверкой формата.
create or replace function public.enforce_profile_update_permissions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin()
     or coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true' then
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
  new.pending_discount_percent := old.pending_discount_percent;
  new.duel_rating := old.duel_rating;
  new.email := old.email;
  new.id := old.id;
  new.created_at := old.created_at;

  if public.is_moderator() then
    -- модератор может начислять монеты другим, но не больше 1000 за раз
    if new.bonus_coins - old.bonus_coins > 1000 then
      new.bonus_coins := old.bonus_coins + 1000;
    end if;
    return new;
  end if;

  new.is_banned := old.is_banned;
  new.ban_reason := old.ban_reason;
  new.bonus_coins := old.bonus_coins;

  return new;
end;
$$;

-- 2. Кому можно активировать код.
alter table public.promo_codes
  add column if not exists audience text not null default 'new';
alter table public.promo_codes drop constraint if exists promo_codes_audience_check;
alter table public.promo_codes
  add constraint promo_codes_audience_check check (audience in ('new', 'existing', 'all'));
update public.promo_codes set audience = 'all' where type = 'coins' and audience <> 'all';

-- 3. Скидка, применённая к платежу.
alter table public.payments
  add column if not exists discount_percent integer not null default 0;

-- 4. Активация.
create or replace function public.redeem_promo_code(p_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_promo public.promo_codes;
  v_user_created timestamptz;
  v_is_new boolean;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_promo from public.promo_codes
    where lower(code) = lower(trim(p_code)) and active
    for update;
  if not found then
    raise exception 'promo_not_found';
  end if;

  if v_promo.activations_count >= v_promo.max_activations then
    raise exception 'promo_exhausted';
  end if;

  if exists (select 1 from public.promo_redemptions where promo_id = v_promo.id and user_id = auth.uid()) then
    raise exception 'promo_already_used';
  end if;

  select created_at into v_user_created from auth.users where id = auth.uid();
  v_is_new := (now() - v_user_created) < interval '24 hours';

  if v_promo.type in ('subscription', 'discount') then
    if v_promo.audience = 'new' and not v_is_new then
      raise exception 'promo_new_users_only';
    elsif v_promo.audience = 'existing' and v_is_new then
      raise exception 'promo_existing_users_only';
    end if;
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);

  insert into public.promo_redemptions (promo_id, user_id) values (v_promo.id, auth.uid());
  update public.promo_codes set activations_count = activations_count + 1 where id = v_promo.id;

  if v_promo.type = 'subscription' then
    select * into v_profile from public.profiles where id = auth.uid();
    update public.profiles
    set plan_tier = case
          -- действующий тариф выше выдаваемого не понижаем: просто продлеваем его
          when v_profile.plan_tier = 'max' and v_profile.plan_expires_at > now() then 'max'
          else v_promo.subscription_tier
        end,
        plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + make_interval(days => v_promo.subscription_days),
        plan_billing_period = case
          when v_profile.plan_tier <> 'basic' and v_profile.plan_expires_at > now() then plan_billing_period
          when v_promo.subscription_days >= 365 then 'annual'
          else 'monthly'
        end,
        plan_expiry_notice_3d_sent = false,
        plan_expiry_notice_1d_sent = false
    where id = auth.uid();
  elsif v_promo.type = 'coins' then
    update public.profiles set bonus_coins = coalesce(bonus_coins, 0) + v_promo.coins_amount where id = auth.uid();
  elsif v_promo.type = 'discount' then
    update public.profiles
    set pending_discount_percent = greatest(coalesce(pending_discount_percent, 0), v_promo.discount_percent)
    where id = auth.uid();
  end if;

  return jsonb_build_object(
    'type', v_promo.type,
    'discountPercent', v_promo.discount_percent,
    'subscriptionTier', v_promo.subscription_tier,
    'subscriptionDays', v_promo.subscription_days,
    'coinsAmount', v_promo.coins_amount
  );
end;
$$;

grant execute on function public.redeem_promo_code(text) to authenticated;

-- 5. Создание кода — с выбором аудитории.
drop function if exists public.create_promo_code(text, text, integer, text, integer, integer, integer);

create or replace function public.create_promo_code(
  p_code text,
  p_type text,
  p_discount_percent integer default null,
  p_subscription_tier text default null,
  p_subscription_days integer default null,
  p_coins_amount integer default null,
  p_max_activations integer default 1,
  p_audience text default 'new'
)
returns public.promo_codes
language plpgsql
security definer set search_path = public
as $$
declare
  v_is_staff boolean;
  v_row public.promo_codes;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select (is_admin or is_moderator) into v_is_staff from public.profiles where id = auth.uid();
  if not coalesce(v_is_staff, false) then
    raise exception 'not_allowed';
  end if;

  if p_type = 'discount' and (p_discount_percent is null or p_discount_percent < 1 or p_discount_percent > 99) then
    raise exception 'invalid_discount' using detail = 'Скидка — от 1 до 99%.';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);

  insert into public.promo_codes (
    code, type, discount_percent, subscription_tier, subscription_days,
    coins_amount, max_activations, created_by, audience
  ) values (
    upper(trim(p_code)), p_type, p_discount_percent, p_subscription_tier, p_subscription_days,
    p_coins_amount, coalesce(p_max_activations, 1), auth.uid(),
    case when p_type = 'coins' then 'all' else coalesce(p_audience, 'new') end
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_promo_code(text, text, integer, text, integer, integer, integer, text) from public, anon;
grant execute on function public.create_promo_code(text, text, integer, text, integer, integer, integer, text) to authenticated;

-- 6. Довыдать подписку тем, кто активировал код, пока триггер её
--    откатывал: если по такому коду у человека сейчас нет действующего
--    платного тарифа, а срок от даты активации ещё не вышел — выдаём.
do $$
begin
  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.profiles p
  set plan_tier = x.subscription_tier,
      plan_expires_at = x.redeemed_at + make_interval(days => x.subscription_days),
      plan_billing_period = case when x.subscription_days >= 365 then 'annual' else 'monthly' end
  from (
    select distinct on (r.user_id) r.user_id, r.redeemed_at, c.subscription_tier, c.subscription_days
    from public.promo_redemptions r
    join public.promo_codes c on c.id = r.promo_id
    where c.type = 'subscription'
      and r.redeemed_at + make_interval(days => c.subscription_days) > now()
    order by r.user_id, r.redeemed_at desc
  ) x
  where p.id = x.user_id
    and (p.plan_tier = 'basic' or p.plan_expires_at is null or p.plan_expires_at < now());
end $$;

notify pgrst, 'reload schema';

-- Кто активировал коды на монеты (монеты по ним тоже могли не дойти) —
-- посмотреть и при необходимости начислить вручную через админку:
--   select c.code, c.coins_amount, u.email, r.redeemed_at, p.bonus_coins
--   from public.promo_redemptions r
--   join public.promo_codes c on c.id = r.promo_id
--   join auth.users u on u.id = r.user_id
--   join public.profiles p on p.id = r.user_id
--   where c.type = 'coins' order by r.redeemed_at desc;
