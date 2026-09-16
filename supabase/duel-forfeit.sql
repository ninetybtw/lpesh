-- LexPrep — сдаться в дуэли по-настоящему: раньше "Сдаться" просто
-- досрочно отправляло свой счёт (duel_submit_score), но дуэль не
-- завершалась, пока соперник тоже не отправит свой — то есть тот, кто
-- сдался, видел поражение, а соперник как ни в чём не бывало продолжал
-- играть, ничего не зная о сдаче. duel_forfeit завершает дуэль СРАЗУ,
-- засчитывая победу сопернику независимо от того, сколько вопросов кто
-- успел пройти — соперник узнаёт об этом на следующем опросе сервера
-- (см. duel-pvp.js) и не должен доигрывать матч, которого уже нет.
-- Выполнить один раз в SQL Editor, ПОСЛЕ duels-tournaments-robustness.sql.

create or replace function public.duel_forfeit(p_challenge_id uuid)
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

  if auth.uid() = v_row.challenger_id then
    v_is_challenger := true;
  elsif auth.uid() = v_row.opponent_id then
    v_is_challenger := false;
  else
    raise exception 'not_a_participant';
  end if;

  v_expected := 1.0 / (1.0 + power(10.0, (v_row.opponent_rating_before - v_row.challenger_rating_before) / 400.0));
  -- v_actual — результат ИМЕННО челленджера: 0, если сдался он сам, 1 —
  -- если сдался соперник (тогда челленджер автоматически победил).
  v_actual := case when v_is_challenger then 0.0 else 1.0 end;
  v_delta := round(v_k * (v_actual - v_expected));

  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.pvp_duels
  set status = 'completed',
      completed_at = now(),
      challenger_score = coalesce(challenger_score, case when v_is_challenger then 0 else question_count end),
      opponent_score = coalesce(opponent_score, case when v_is_challenger then question_count else 0 end),
      challenger_played_at = coalesce(challenger_played_at, now()),
      opponent_played_at = coalesce(opponent_played_at, now()),
      challenger_rating_delta = v_delta,
      opponent_rating_delta = -v_delta,
      winner_id = case when v_is_challenger then opponent_id else challenger_id end
  where id = p_challenge_id
  returning * into v_row;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.profiles set duel_rating = greatest(0, duel_rating + v_delta) where id = v_row.challenger_id;
  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.profiles set duel_rating = greatest(0, duel_rating - v_delta) where id = v_row.opponent_id;

  return v_row;
end;
$$;

grant execute on function public.duel_forfeit(uuid) to authenticated;
