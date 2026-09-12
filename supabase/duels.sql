-- LexPrep — Supabase migration: дуэли против реальных игроков (PvP).
-- Выполнить один раз в SQL Editor, ПОСЛЕ support-suggestions.sql.
--
-- Модель: открытое лобби. Игрок создаёт вызов (открытый, без конкретного
-- соперника) с фиксированным набором вопросов; любой другой пользователь
-- может его принять. Дальше оба играют один и тот же набор вопросов
-- независимо (асинхронно, как в тренажёре) и отправляют свой счёт —
-- как только оба счёта на месте, считается победитель и дуэльный
-- рейтинг обеих сторон обновляется по формуле Эло.
--
-- Все переходы состояния (принять вызов, отправить счёт, посчитать
-- рейтинг) идут через security definer функции ниже — они сами проверяют
-- права вызывающего и единственные, кто может реально поменять статус,
-- счёт или profiles.duel_rating. Прямой UPDATE от клиента по таблице
-- блокируется триггером (кроме отмены игроком своего же открытого
-- вызова).

alter table public.profiles
  add column if not exists duel_rating integer not null default 1000;

create table if not exists public.pvp_duels (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid references auth.users(id) on delete cascade,
  discipline text not null,
  topic text not null,
  question_ids jsonb not null,
  question_count integer not null check (question_count between 3 and 30),
  status text not null default 'open' check (status in ('open', 'accepted', 'completed', 'cancelled')),
  challenger_score integer,
  opponent_score integer,
  challenger_played_at timestamptz,
  opponent_played_at timestamptz,
  winner_id uuid references auth.users(id),
  challenger_rating_before integer,
  opponent_rating_before integer,
  challenger_rating_delta integer,
  opponent_rating_delta integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint pvp_duels_opponent_not_challenger check (opponent_id is distinct from challenger_id)
);

alter table public.pvp_duels enable row level security;

drop policy if exists "View own or open duels" on public.pvp_duels;
create policy "View own or open duels"
  on public.pvp_duels for select
  using (
    auth.uid() is not null
    and (status = 'open' or challenger_id = auth.uid() or opponent_id = auth.uid())
  );

drop policy if exists "Create own open challenge" on public.pvp_duels;
create policy "Create own open challenge"
  on public.pvp_duels for insert
  with check (challenger_id = auth.uid() and status = 'open' and opponent_id is null);

drop policy if exists "Update own or trusted rpc" on public.pvp_duels;
create policy "Update own or trusted rpc"
  on public.pvp_duels for update
  using (
    coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true'
    or challenger_id = auth.uid()
    or opponent_id = auth.uid()
  );

-- Прямой UPDATE со стороны клиента разрешаем только на одно действие:
-- challenger отменяет свой ещё не принятый вызов. Всё остальное (принятие,
-- счёт, статус, рейтинг) идёт только через security definer RPC ниже,
-- которые перед своим UPDATE помечают транзакцию как доверенную через
-- set_config('lexprep.trusted_rpc', 'true', true).
create or replace function public.enforce_pvp_duel_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true' then
    return new;
  end if;

  if auth.uid() = old.challenger_id and old.status = 'open' and new.status = 'cancelled' then
    new.discipline := old.discipline;
    new.topic := old.topic;
    new.question_count := old.question_count;
    new.question_ids := old.question_ids;
    new.challenger_id := old.challenger_id;
    new.opponent_id := old.opponent_id;
    new.challenger_score := old.challenger_score;
    new.opponent_score := old.opponent_score;
    new.challenger_played_at := old.challenger_played_at;
    new.opponent_played_at := old.opponent_played_at;
    new.winner_id := old.winner_id;
    new.challenger_rating_before := old.challenger_rating_before;
    new.opponent_rating_before := old.opponent_rating_before;
    new.challenger_rating_delta := old.challenger_rating_delta;
    new.opponent_rating_delta := old.opponent_rating_delta;
    new.created_at := old.created_at;
    new.completed_at := old.completed_at;
    return new;
  end if;

  raise exception 'not_allowed';
end;
$$;

drop trigger if exists enforce_pvp_duel_update on public.pvp_duels;
create trigger enforce_pvp_duel_update
  before update on public.pvp_duels
  for each row execute procedure public.enforce_pvp_duel_update();

-- ---------------------------------------------------------------------
-- profiles.duel_rating — как и другие серверные поля, обычный
-- пользователь через свой же UPDATE его менять не может (только через
-- duel_submit_score ниже, который сам себе разрешает trusted_rpc).

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
  new.is_banned := old.is_banned;
  new.ban_reason := old.ban_reason;
  new.bonus_coins := old.bonus_coins;
  new.plan_tier := old.plan_tier;
  new.plan_expires_at := old.plan_expires_at;
  new.duel_rating := old.duel_rating;
  new.email := old.email;
  new.id := old.id;
  new.created_at := old.created_at;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Принять открытый вызов. Фиксирует текущий рейтинг обеих сторон в
-- challenger_rating_before/opponent_rating_before — от них потом
-- считается итоговое изменение рейтинга.

create or replace function public.duel_accept_challenge(p_challenge_id uuid)
returns public.pvp_duels
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.pvp_duels;
  v_challenger_rating integer;
  v_opponent_rating integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row from public.pvp_duels where id = p_challenge_id for update;
  if not found then
    raise exception 'challenge_not_found';
  end if;
  if v_row.status <> 'open' then
    raise exception 'challenge_not_open';
  end if;
  if v_row.challenger_id = auth.uid() then
    raise exception 'cannot_accept_own_challenge';
  end if;

  select duel_rating into v_challenger_rating from public.profiles where id = v_row.challenger_id;
  select duel_rating into v_opponent_rating from public.profiles where id = auth.uid();

  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.pvp_duels
  set opponent_id = auth.uid(),
      status = 'accepted',
      challenger_rating_before = coalesce(v_challenger_rating, 1000),
      opponent_rating_before = coalesce(v_opponent_rating, 1000)
  where id = p_challenge_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Отправить свой счёт. Когда оба счёта на месте — считает победителя и
-- изменение рейтинга (Эло, K=32) и сразу применяет его к profiles обеих
-- сторон.

create or replace function public.duel_submit_score(p_challenge_id uuid, p_score integer)
returns public.pvp_duels
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.pvp_duels;
  v_is_challenger boolean;
  v_expected numeric;
  v_actual numeric;
  v_delta integer;
  v_k constant integer := 32;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row from public.pvp_duels where id = p_challenge_id for update;
  if not found then
    raise exception 'challenge_not_found';
  end if;
  if v_row.status <> 'accepted' then
    raise exception 'challenge_not_active';
  end if;
  if p_score < 0 or p_score > v_row.question_count then
    raise exception 'invalid_score';
  end if;

  if auth.uid() = v_row.challenger_id then
    v_is_challenger := true;
  elsif auth.uid() = v_row.opponent_id then
    v_is_challenger := false;
  else
    raise exception 'not_a_participant';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);

  if v_is_challenger then
    if v_row.challenger_played_at is not null then
      raise exception 'already_submitted';
    end if;
    update public.pvp_duels set challenger_score = p_score, challenger_played_at = now()
    where id = p_challenge_id returning * into v_row;
  else
    if v_row.opponent_played_at is not null then
      raise exception 'already_submitted';
    end if;
    update public.pvp_duels set opponent_score = p_score, opponent_played_at = now()
    where id = p_challenge_id returning * into v_row;
  end if;

  if v_row.challenger_played_at is not null and v_row.opponent_played_at is not null then
    v_expected := 1.0 / (1.0 + power(10.0, (v_row.opponent_rating_before - v_row.challenger_rating_before) / 400.0));
    if v_row.challenger_score > v_row.opponent_score then
      v_actual := 1.0;
    elsif v_row.challenger_score < v_row.opponent_score then
      v_actual := 0.0;
    else
      v_actual := 0.5;
    end if;
    v_delta := round(v_k * (v_actual - v_expected));

    perform set_config('lexprep.trusted_rpc', 'true', true);
    update public.pvp_duels
    set status = 'completed',
        completed_at = now(),
        challenger_rating_delta = v_delta,
        opponent_rating_delta = -v_delta,
        winner_id = case
          when v_row.challenger_score > v_row.opponent_score then v_row.challenger_id
          when v_row.challenger_score < v_row.opponent_score then v_row.opponent_id
          else null
        end
    where id = p_challenge_id
    returning * into v_row;

    perform set_config('lexprep.trusted_rpc', 'true', true);
    update public.profiles set duel_rating = greatest(0, duel_rating + v_delta) where id = v_row.challenger_id;
    perform set_config('lexprep.trusted_rpc', 'true', true);
    update public.profiles set duel_rating = greatest(0, duel_rating - v_delta) where id = v_row.opponent_id;
  end if;

  return v_row;
end;
$$;
