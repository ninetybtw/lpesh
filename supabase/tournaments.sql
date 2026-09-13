-- LexPrep — Supabase migration: реальные многопользовательские турниры.
-- Выполнить один раз в SQL Editor, ПОСЛЕ duels.sql (переиспользует
-- profiles.bonus_coins и тот же lexprep.trusted_rpc-приём для защиты
-- прямых UPDATE от клиента).
--
-- Формат: турнирная сетка на выбывание (как раньше с ботами), но с
-- реальными соперниками. Два зашитых типа — 'quick' (4 игрока, 5
-- вопросов на матч) и 'weekly' (8 игроков, 10 вопросов на матч),
-- зеркалит TOURNAMENTS в старом tournaments.js.
--
-- tournaments        — один запущенный экземпляр турнира (лобби → идёт →
--                       завершён).
-- tournament_participants — кто в лобби/сетке.
-- tournament_matches — конкретные 1v1 матчи по раундам; синхронный старт
--                       и общий таймер на вопрос — тот же приём, что и в
--                       pvp_duels (started_at, оба клиента считают текущий
--                       вопрос сами по формуле elapsed/seconds_per_question).
--
-- Все изменения идут только через security definer RPC ниже — прямых
-- insert/update/delete-политик для обычных пользователей нет вообще,
-- поэтому клиент физически не может изменить эти таблицы напрямую.

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  type_id text not null check (type_id in ('quick', 'weekly')),
  size integer not null check (size in (4, 8)),
  questions_per_match integer not null,
  prize_coins integer not null,
  seconds_per_question integer not null default 20,
  status text not null default 'open' check (status in ('open', 'active', 'completed')),
  current_round integer not null default 0,
  winner_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.tournament_participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  -- денормализовано с tournaments.type_id — чтобы клиент мог одним
  -- простым запросом найти "моё текущее участие в турнире типа X" без
  -- join'а на другую таблицу под RLS.
  type_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  eliminated_round integer,
  unique (tournament_id, user_id)
);

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round integer not null,
  slot integer not null,
  player1_id uuid not null references auth.users(id),
  player2_id uuid not null references auth.users(id),
  question_ids jsonb not null,
  player1_ready boolean not null default false,
  player2_ready boolean not null default false,
  started_at timestamptz,
  player1_score integer,
  player2_score integer,
  player1_played_at timestamptz,
  player2_played_at timestamptz,
  winner_id uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'active', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tournament_id, round, slot)
);

alter table public.tournaments enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.tournament_matches enable row level security;

-- Публичное чтение (любому залогиненному) — тут нет ничего чувствительнее,
-- чем в открытом лобби дуэлей; вся защита — на insert/update.
drop policy if exists "Anyone authenticated can view tournaments" on public.tournaments;
create policy "Anyone authenticated can view tournaments"
  on public.tournaments for select
  using (auth.uid() is not null);

drop policy if exists "Trusted RPC can write tournaments" on public.tournaments;
create policy "Trusted RPC can write tournaments"
  on public.tournaments for insert
  with check (coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true');

drop policy if exists "Trusted RPC can update tournaments" on public.tournaments;
create policy "Trusted RPC can update tournaments"
  on public.tournaments for update
  using (coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true');

drop policy if exists "Anyone authenticated can view participants" on public.tournament_participants;
create policy "Anyone authenticated can view participants"
  on public.tournament_participants for select
  using (auth.uid() is not null);

drop policy if exists "Trusted RPC can insert participants" on public.tournament_participants;
create policy "Trusted RPC can insert participants"
  on public.tournament_participants for insert
  with check (coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true');

drop policy if exists "Trusted RPC can update participants" on public.tournament_participants;
create policy "Trusted RPC can update participants"
  on public.tournament_participants for update
  using (coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true');

drop policy if exists "Anyone authenticated can view matches" on public.tournament_matches;
create policy "Anyone authenticated can view matches"
  on public.tournament_matches for select
  using (auth.uid() is not null);

drop policy if exists "Trusted RPC can insert matches" on public.tournament_matches;
create policy "Trusted RPC can insert matches"
  on public.tournament_matches for insert
  with check (coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true');

drop policy if exists "Trusted RPC can update matches" on public.tournament_matches;
create policy "Trusted RPC can update matches"
  on public.tournament_matches for update
  using (coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true');

-- ---------------------------------------------------------------------
-- Подбор вопросов для матча — n случайных тем с реальными тестами,
-- по одному случайному вопросу из каждой. Формат {topicId, qIndex} —
-- тот же, что у pvp_duels.question_ids, раскрывается на клиенте той же
-- функцией DuelEngine.resolveQuestions (см. duel-engine.js).

create or replace function public.tournament_pick_questions(p_count integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_row record;
  v_qcount integer;
  v_idx integer;
begin
  for v_row in
    select topic_id, questions from public.topic_quiz
    where jsonb_array_length(questions) > 0
    order by random()
    limit p_count
  loop
    v_qcount := jsonb_array_length(v_row.questions);
    v_idx := floor(random() * v_qcount);
    v_result := v_result || jsonb_build_object('topicId', v_row.topic_id, 'qIndex', v_idx);
  end loop;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Вступить в лобби турнира выбранного типа. Если после вступления
-- набралось нужное число игроков — сразу перемешивает их и создаёт пары
-- первого раунда (started_at там ещё не выставлен — это делает отдельный
-- tournament_match_ready ниже, когда оба игрока конкретного матча готовы).

create or replace function public.tournament_join(p_type_id text)
returns public.tournaments
language plpgsql
security definer set search_path = public
as $$
declare
  v_tournament public.tournaments;
  v_size integer;
  v_questions_per_match integer;
  v_prize integer;
  v_count integer;
  v_participant_ids uuid[];
  i integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_type_id = 'quick' then
    v_size := 4; v_questions_per_match := 5; v_prize := 150;
  elsif p_type_id = 'weekly' then
    v_size := 8; v_questions_per_match := 10; v_prize := 320;
  else
    raise exception 'unknown_tournament_type';
  end if;

  select * into v_tournament
  from public.tournaments
  where type_id = p_type_id and status = 'open'
  order by created_at asc
  limit 1
  for update;

  if not found then
    perform set_config('lexprep.trusted_rpc', 'true', true);
    insert into public.tournaments (type_id, size, questions_per_match, prize_coins)
    values (p_type_id, v_size, v_questions_per_match, v_prize)
    returning * into v_tournament;
  end if;

  if exists (
    select 1 from public.tournament_participants tp
    join public.tournaments t on t.id = tp.tournament_id
    where tp.user_id = auth.uid() and t.type_id = p_type_id and t.status in ('open', 'active')
  ) then
    raise exception 'already_in_tournament';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  insert into public.tournament_participants (tournament_id, type_id, user_id)
  values (v_tournament.id, p_type_id, auth.uid());

  select count(*) into v_count from public.tournament_participants where tournament_id = v_tournament.id;

  if v_count >= v_tournament.size then
    select array_agg(user_id order by random()) into v_participant_ids
    from public.tournament_participants where tournament_id = v_tournament.id;

    perform set_config('lexprep.trusted_rpc', 'true', true);
    update public.tournaments set status = 'active', current_round = 1, started_at = now()
    where id = v_tournament.id returning * into v_tournament;

    for i in 1..(v_tournament.size / 2) loop
      perform set_config('lexprep.trusted_rpc', 'true', true);
      insert into public.tournament_matches (tournament_id, round, slot, player1_id, player2_id, question_ids)
      values (
        v_tournament.id, 1, i,
        v_participant_ids[i * 2 - 1], v_participant_ids[i * 2],
        public.tournament_pick_questions(v_tournament.questions_per_match)
      );
    end loop;
  end if;

  return v_tournament;
end;
$$;

-- ---------------------------------------------------------------------
-- Отметиться готовым к конкретному матчу — та же логика синхронного
-- старта, что и duel_mark_ready в duels.sql.

create or replace function public.tournament_match_ready(p_match_id uuid)
returns public.tournament_matches
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.tournament_matches;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row from public.tournament_matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'match_not_pending';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  if auth.uid() = v_row.player1_id then
    update public.tournament_matches set player1_ready = true where id = p_match_id returning * into v_row;
  elsif auth.uid() = v_row.player2_id then
    update public.tournament_matches set player2_ready = true where id = p_match_id returning * into v_row;
  else
    raise exception 'not_a_participant';
  end if;

  if v_row.player1_ready and v_row.player2_ready and v_row.started_at is null then
    perform set_config('lexprep.trusted_rpc', 'true', true);
    update public.tournament_matches set started_at = now(), status = 'active'
    where id = p_match_id returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Отправить счёт по матчу. Когда оба счёта на месте — определяет
-- победителя, помечает проигравшего выбывшим и, если это был последний
-- незавершённый матч раунда, либо создаёт пары следующего раунда, либо
-- (если раунд был финалом) завершает турнир и начисляет приз победителю.

create or replace function public.tournament_submit_score(p_match_id uuid, p_score integer)
returns public.tournament_matches
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.tournament_matches;
  v_tournament public.tournaments;
  v_loser_id uuid;
  v_round_total integer;
  v_round_done integer;
  v_winners uuid[];
  i integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row from public.tournament_matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if v_row.status <> 'active' then
    raise exception 'match_not_active';
  end if;
  if p_score < 0 then
    raise exception 'invalid_score';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  if auth.uid() = v_row.player1_id then
    if v_row.player1_played_at is not null then raise exception 'already_submitted'; end if;
    update public.tournament_matches set player1_score = p_score, player1_played_at = now()
    where id = p_match_id returning * into v_row;
  elsif auth.uid() = v_row.player2_id then
    if v_row.player2_played_at is not null then raise exception 'already_submitted'; end if;
    update public.tournament_matches set player2_score = p_score, player2_played_at = now()
    where id = p_match_id returning * into v_row;
  else
    raise exception 'not_a_participant';
  end if;

  if v_row.player1_played_at is null or v_row.player2_played_at is null then
    return v_row;
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.tournament_matches
  set status = 'completed',
      completed_at = now(),
      winner_id = case
        when v_row.player1_score > v_row.player2_score then v_row.player1_id
        when v_row.player1_score < v_row.player2_score then v_row.player2_id
        -- ничья решается жребием — оба одинаково честно прошли одинаковый
        -- набор вопросов за одинаковое время, дальше нужен единственный
        -- победитель для сетки на выбывание
        else (array[v_row.player1_id, v_row.player2_id])[1 + floor(random() * 2)::int]
      end
  where id = p_match_id
  returning * into v_row;

  v_loser_id := case when v_row.winner_id = v_row.player1_id then v_row.player2_id else v_row.player1_id end;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.tournament_participants
  set eliminated_round = v_row.round
  where tournament_id = v_row.tournament_id and user_id = v_loser_id;

  select * into v_tournament from public.tournaments where id = v_row.tournament_id for update;

  select count(*) into v_round_total from public.tournament_matches
  where tournament_id = v_row.tournament_id and round = v_row.round;
  select count(*) into v_round_done from public.tournament_matches
  where tournament_id = v_row.tournament_id and round = v_row.round and status = 'completed';

  if v_round_done = v_round_total then
    if v_round_total = 1 then
      perform set_config('lexprep.trusted_rpc', 'true', true);
      update public.tournaments
      set status = 'completed', completed_at = now(), winner_id = v_row.winner_id
      where id = v_row.tournament_id;

      perform set_config('lexprep.trusted_rpc', 'true', true);
      update public.profiles set bonus_coins = bonus_coins + v_tournament.prize_coins
      where id = v_row.winner_id;
    else
      select array_agg(winner_id order by slot) into v_winners
      from public.tournament_matches
      where tournament_id = v_row.tournament_id and round = v_row.round;

      perform set_config('lexprep.trusted_rpc', 'true', true);
      update public.tournaments set current_round = v_row.round + 1 where id = v_row.tournament_id;

      for i in 1..(array_length(v_winners, 1) / 2) loop
        perform set_config('lexprep.trusted_rpc', 'true', true);
        insert into public.tournament_matches (tournament_id, round, slot, player1_id, player2_id, question_ids)
        values (
          v_row.tournament_id, v_row.round + 1, i,
          v_winners[i * 2 - 1], v_winners[i * 2],
          public.tournament_pick_questions(v_tournament.questions_per_match)
        );
      end loop;
    end if;
  end if;

  return v_row;
end;
$$;
