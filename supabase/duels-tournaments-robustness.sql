-- LexPrep — устойчивость дуэлей и турниров к "пропавшим" соперникам +
-- явный форфейт/выход. Выполнить один раз в SQL Editor, ПОСЛЕ duels.sql,
-- duels-progress.sql, tournaments.sql, tournaments-progress.sql.
--
-- Проблема, которую чинит этот файл: если соперник закрыл вкладку и не
-- вернулся (не отправил счёт / не нажал "готов"), дуэль или турнирный
-- матч раньше зависали НАВСЕГДА — заявка ждала второй счёт, которого
-- никогда не будет, и следующий раунд турнира никогда не формировался.
--
-- Решение:
--   1. duel_submit_score/tournament_submit_score теперь сами замечают,
--      что прошло намного больше времени, чем нужно на раунд вопросов
--      (или что заявка/матч висит без ответа соперника слишком долго
--      без старта вообще), и автоматически засчитывают пропавшей
--      стороне поражение (score = 0) в момент, когда ЖИВОЙ игрок сам
--      отправляет свой результат — без отдельной фоновой задачи.
--   2. Явный форфейт: duel_submit_score можно вызвать с любым счётом
--      (в т.ч. 0) на любой стадии после принятия вызова — это уже
--      достаточно, чтобы сдаться самому. Для турниров, где матч ещё не
--      начался (оба не готовы), добавлена отдельная tournament_forfeit_match.
--   3. tournament_leave_lobby — выйти из очереди турнира, пока лобби ещё
--      не набралось (до этого выйти было вообще нельзя).

-- =======================================================================
-- 1. Дуэли: автоматический форфейт пропавшего соперника.
-- =======================================================================

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
  v_stale boolean;
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

  -- Соперник пропал: либо бой давно должен был закончиться (весь тайминг
  -- вопросов истёк + запас 2 минуты), либо заявка вообще не стартовала
  -- (никто не нажал "готов") дольше 15 минут с момента принятия. В обоих
  -- случаях засчитываем пропавшей стороне score = 0, чтобы дуэль не
  -- висела вечно.
  v_stale := (
    v_row.started_at is not null
    and now() > v_row.started_at + make_interval(secs => v_row.seconds_per_question * v_row.question_count) + interval '2 minutes'
  ) or (
    v_row.started_at is null
    and now() > v_row.created_at + interval '15 minutes'
  );

  if v_stale then
    if v_row.challenger_played_at is null then
      perform set_config('lexprep.trusted_rpc', 'true', true);
      update public.pvp_duels set challenger_score = 0, challenger_played_at = now()
      where id = p_challenge_id returning * into v_row;
    end if;
    if v_row.opponent_played_at is null then
      perform set_config('lexprep.trusted_rpc', 'true', true);
      update public.pvp_duels set opponent_score = 0, opponent_played_at = now()
      where id = p_challenge_id returning * into v_row;
    end if;
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

-- =======================================================================
-- 2. Турниры: тот же приём для tournament_submit_score + отдельный
--    форфейт для матча, который ещё не стартовал (оба не были готовы) —
--    submit_score требует status = 'active', а на этой стадии матч ещё
--    'pending'.
-- =======================================================================

-- Общая "развилка после того, как исход матча определён" — раньше жила
-- только внутри tournament_submit_score, вынесена сюда, чтобы её же
-- использовал tournament_forfeit_match без дублирования логики сетки.
create or replace function public.tournament_advance_bracket(p_match_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.tournament_matches;
  v_tournament public.tournaments;
  v_round_total integer;
  v_round_done integer;
  v_winners uuid[];
  i integer;
begin
  select * into v_row from public.tournament_matches where id = p_match_id;
  select * into v_tournament from public.tournaments where id = v_row.tournament_id for update;

  select count(*) into v_round_total from public.tournament_matches
  where tournament_id = v_row.tournament_id and round = v_row.round;
  select count(*) into v_round_done from public.tournament_matches
  where tournament_id = v_row.tournament_id and round = v_row.round and status = 'completed';

  if v_round_done < v_round_total then
    return;
  end if;

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
end;
$$;

create or replace function public.tournament_submit_score(p_match_id uuid, p_score integer)
returns public.tournament_matches
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.tournament_matches;
  v_tournament public.tournaments;
  v_loser_id uuid;
  v_stale boolean;
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

  select * into v_tournament from public.tournaments where id = v_row.tournament_id;

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

  -- Соперник пропал во время самого матча — весь тайминг вопросов истёк
  -- + запас 2 минуты, а он так и не отправил счёт. Засчитываем ему 0.
  v_stale := v_row.started_at is not null
    and now() > v_row.started_at + make_interval(secs => v_tournament.seconds_per_question * v_tournament.questions_per_match) + interval '2 minutes';

  if v_stale then
    if v_row.player1_played_at is null then
      perform set_config('lexprep.trusted_rpc', 'true', true);
      update public.tournament_matches set player1_score = 0, player1_played_at = now()
      where id = p_match_id returning * into v_row;
    end if;
    if v_row.player2_played_at is null then
      perform set_config('lexprep.trusted_rpc', 'true', true);
      update public.tournament_matches set player2_score = 0, player2_played_at = now()
      where id = p_match_id returning * into v_row;
    end if;
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
        else (array[v_row.player1_id, v_row.player2_id])[1 + floor(random() * 2)::int]
      end
  where id = p_match_id
  returning * into v_row;

  v_loser_id := case when v_row.winner_id = v_row.player1_id then v_row.player2_id else v_row.player1_id end;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.tournament_participants
  set eliminated_round = v_row.round
  where tournament_id = v_row.tournament_id and user_id = v_loser_id;

  perform public.tournament_advance_bracket(p_match_id);

  return v_row;
end;
$$;

-- Форфейт матча, который ещё не начался (оба игрока не были готовы) —
-- submit_score тут не подходит, он требует status = 'active'. Также
-- покрывает случай "матч давно pending, соперник не появляется": можно
-- вызвать в любой момент, ограничений по времени нет — сдаться можно
-- сразу, это осознанное действие игрока, а не автоматический таймаут.
create or replace function public.tournament_forfeit_match(p_match_id uuid)
returns public.tournament_matches
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.tournament_matches;
  v_loser_id uuid;
  v_winner_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row from public.tournament_matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if v_row.status = 'completed' then
    raise exception 'match_already_completed';
  end if;

  if auth.uid() = v_row.player1_id then
    v_loser_id := v_row.player1_id;
    v_winner_id := v_row.player2_id;
  elsif auth.uid() = v_row.player2_id then
    v_loser_id := v_row.player2_id;
    v_winner_id := v_row.player1_id;
  else
    raise exception 'not_a_participant';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.tournament_matches
  set status = 'completed',
      completed_at = now(),
      winner_id = v_winner_id,
      player1_score = coalesce(player1_score, case when player1_id = v_loser_id then 0 else player1_score end),
      player2_score = coalesce(player2_score, case when player2_id = v_loser_id then 0 else player2_score end),
      player1_played_at = coalesce(player1_played_at, now()),
      player2_played_at = coalesce(player2_played_at, now())
  where id = p_match_id
  returning * into v_row;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.tournament_participants
  set eliminated_round = v_row.round
  where tournament_id = v_row.tournament_id and user_id = v_loser_id;

  perform public.tournament_advance_bracket(p_match_id);

  return v_row;
end;
$$;

grant execute on function public.tournament_forfeit_match(uuid) to authenticated;

-- Выйти из очереди турнира, пока лобби ещё не набралось (status = 'open').
-- До этого выйти было вообще нельзя — раз зашёл, жди либо старта, либо
-- вечно.
create or replace function public.tournament_leave_lobby(p_type_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_tournament_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select tp.tournament_id into v_tournament_id
  from public.tournament_participants tp
  join public.tournaments t on t.id = tp.tournament_id
  where tp.user_id = auth.uid() and tp.type_id = p_type_id and t.status = 'open'
  limit 1;

  if v_tournament_id is null then
    raise exception 'not_in_open_lobby';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  delete from public.tournament_participants
  where tournament_id = v_tournament_id and user_id = auth.uid();
end;
$$;

grant execute on function public.tournament_leave_lobby(text) to authenticated;

-- tournament_participants ещё не разрешал клиенту delete себя даже через
-- RPC (RLS на этой таблице раньше знала только insert/update) — добавляем
-- delete-политику под тот же trusted_rpc-приём.
drop policy if exists "Trusted RPC can delete participants" on public.tournament_participants;
create policy "Trusted RPC can delete participants"
  on public.tournament_participants for delete
  using (coalesce(current_setting('lexprep.trusted_rpc', true), '') = 'true');
