-- LexPrep — промокоды: реферальные/на подписку (только для новых
-- пользователей) и на монеты (для всех). Выполнить один раз в SQL Editor.
--
-- Три типа:
--   discount     — скидка % (копится в profiles.pending_discount_percent,
--                  реального платёжного шлюза в проекте ещё нет — это
--                  задел на будущее, сейчас нигде не списывается);
--   subscription — выдаёт тариф (pro/max) на N дней сразу на сервере,
--                  как если бы это сделал админ (profiles.plan_tier);
--   coins        — начисляет монеты (profiles.bonus_coins).
--
-- discount/subscription — только для новых аккаунтов (auth.users.created_at
-- не старше 24 часов на момент активации). coins — можно вводить в любой
-- момент, в том числе существующим пользователям (см. shop.html).
--
-- Активации ограничены max_activations (по умолчанию 1) — после
-- исчерпания лимита код перестаёт работать. Один и тот же пользователь
-- не может активировать один код дважды (promo_redemptions).

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type text not null check (type in ('discount', 'subscription', 'coins')),
  discount_percent integer,
  subscription_tier text check (subscription_tier in ('pro', 'max')),
  subscription_days integer,
  coins_amount integer,
  max_activations integer not null default 1,
  activations_count integer not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references public.promo_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (promo_id, user_id)
);

alter table public.profiles add column if not exists pending_discount_percent integer not null default 0;

alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;

-- Сами коды и кто их использовал видят только админы/модераторы —
-- обычный пользователь узнаёт результат активации только через RPC
-- ниже, ему не нужен прямой доступ к таблицам.
drop policy if exists "promo_codes_staff_select" on public.promo_codes;
create policy "promo_codes_staff_select" on public.promo_codes
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin or p.is_moderator))
  );

drop policy if exists "promo_codes_staff_insert" on public.promo_codes;
create policy "promo_codes_staff_insert" on public.promo_codes
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin or p.is_moderator))
  );

drop policy if exists "promo_codes_staff_update" on public.promo_codes;
create policy "promo_codes_staff_update" on public.promo_codes
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin or p.is_moderator))
  );

drop policy if exists "promo_redemptions_staff_select" on public.promo_redemptions;
create policy "promo_redemptions_staff_select" on public.promo_redemptions
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin or p.is_moderator))
  );

-- Активация кода — вся проверка (лимит активаций, "только для новых",
-- повторная активация) и сама выдача происходят здесь одной транзакцией.
create or replace function public.redeem_promo_code(p_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_promo public.promo_codes;
  v_user_created timestamptz;
  v_is_new boolean;
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

  if v_promo.type in ('subscription', 'discount') and not v_is_new then
    raise exception 'promo_new_users_only';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);

  insert into public.promo_redemptions (promo_id, user_id) values (v_promo.id, auth.uid());
  update public.promo_codes set activations_count = activations_count + 1 where id = v_promo.id;

  if v_promo.type = 'subscription' then
    update public.profiles
    set plan_tier = v_promo.subscription_tier,
        plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + make_interval(days => v_promo.subscription_days),
        plan_billing_period = case when v_promo.subscription_days >= 365 then 'annual' else 'monthly' end
    where id = auth.uid();
  elsif v_promo.type = 'coins' then
    update public.profiles set bonus_coins = coalesce(bonus_coins, 0) + v_promo.coins_amount where id = auth.uid();
  elsif v_promo.type = 'discount' then
    update public.profiles set pending_discount_percent = v_promo.discount_percent where id = auth.uid();
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

-- Создание кода — только админ/модератор (проверяется здесь же, не
-- только на фронтенде).
create or replace function public.create_promo_code(
  p_code text,
  p_type text,
  p_discount_percent integer default null,
  p_subscription_tier text default null,
  p_subscription_days integer default null,
  p_coins_amount integer default null,
  p_max_activations integer default 1
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

  perform set_config('lexprep.trusted_rpc', 'true', true);

  insert into public.promo_codes (
    code, type, discount_percent, subscription_tier, subscription_days,
    coins_amount, max_activations, created_by
  ) values (
    upper(trim(p_code)), p_type, p_discount_percent, p_subscription_tier, p_subscription_days,
    p_coins_amount, coalesce(p_max_activations, 1), auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_promo_code(text, text, integer, text, integer, integer, integer) to authenticated;
