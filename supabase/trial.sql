-- LexPrep — пробный период: «Про» на 14 дней за 1 ₽, дальше автоматически
-- помесячная «Про» по полной цене. Выполнить один раз, ПОСЛЕ promo-fix.sql:
--   curl -s https://raw.githubusercontent.com/ninetybtw/lpesh/main/supabase/trial.sql | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
--   docker restart supabase-rest
-- и обновить функции payments-init и payments-notification.
--
-- Как устроено
-- ------------
-- payments-init с {trial: true} проверяет trial_eligible() и создаёт
-- платёж на 1 ₽ с Recurrent=Y — банк привязывает карту и присылает
-- RebillId. payments-notification по подтверждённому пробному платежу
-- включает «Про» на 14 дней, ставит помесячный период и автопродление и
-- отмечает trial_used_at. Через 14 дней обычный payments-autocharge
-- списывает 600 ₽ за месяц «Про» (напоминания за 3 дня и за 1 день
-- уходят как и для любой подписки). Отмена — «Отменить подписку» в
-- профиле: доступ остаётся до конца пробного периода, списания не будет.
--
-- Кому доступно: тем, кто ещё ни разу не платил за подписку, не брал
-- пробный период и у кого сейчас нет действующего платного тарифа.

alter table public.payments
  add column if not exists is_trial boolean not null default false;

alter table public.profiles
  add column if not exists trial_used_at timestamptz,
  add column if not exists plan_is_trial boolean not null default false;

create or replace function public.trial_eligible()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select auth.uid() is not null
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.trial_used_at is not null
             or p.is_banned
             or (p.plan_tier <> 'basic' and p.plan_expires_at > now()))
    )
    and not exists (
      select 1 from public.payments pay
      where pay.user_id = auth.uid() and pay.status in ('confirmed', 'refunded')
    );
$$;

revoke all on function public.trial_eligible() from public, anon;
grant execute on function public.trial_eligible() to authenticated;

-- Триггер прав на profiles — версия из promo-fix.sql + новые поля
-- trial_used_at и plan_is_trial (пользователь не может выставить их себе).
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
  new.trial_used_at := old.trial_used_at;
  new.plan_is_trial := old.plan_is_trial;
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

notify pgrst, 'reload schema';
