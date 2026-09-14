-- LexPrep — Supabase migration: имя создателя дуэли + быстрый переход
-- к следующему вопросу, если ответили оба (не дожидаясь конца таймера).
-- Выполнить один раз, ПОСЛЕ duels.sql.
--
-- challenger_name — денормализовано на момент создания вызова (та же
-- идея, что и author_name у user_tests/user_articles): открытое лобби
-- дуэлей видно всем, а profiles остальных пользователей RLS не отдаёт.
--
-- challenger_progress/opponent_progress — "до какого вопроса включительно
-- дошёл" каждый игрок (после ответа на вопрос N выставляет N+1). Реальный
-- показываемый вопрос = max(время_по_часам, min(challenger_progress,
-- opponent_progress)) — то есть общий таймер продолжает работать как
-- защита (если один игрок молчит, через seconds_per_question всё равно
-- переключит всем), но если оба ответили раньше — сразу переходим
-- дальше, не дожидаясь остатка времени.

alter table public.pvp_duels
  add column if not exists challenger_name text,
  add column if not exists challenger_progress integer not null default 0,
  add column if not exists opponent_progress integer not null default 0;

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
    new.challenger_ready := old.challenger_ready;
    new.opponent_ready := old.opponent_ready;
    new.started_at := old.started_at;
    new.seconds_per_question := old.seconds_per_question;
    new.challenger_name := old.challenger_name;
    new.challenger_progress := old.challenger_progress;
    new.opponent_progress := old.opponent_progress;
    new.created_at := old.created_at;
    new.completed_at := old.completed_at;
    return new;
  end if;

  raise exception 'not_allowed';
end;
$$;

-- Продвинуть свой прогресс (после ответа на вопрос N вызывается с
-- p_progress = N + 1). Монотонно — не даёт откатиться назад.
create or replace function public.duel_advance_progress(p_challenge_id uuid, p_progress integer)
returns public.pvp_duels
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.pvp_duels;
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

  perform set_config('lexprep.trusted_rpc', 'true', true);
  if auth.uid() = v_row.challenger_id then
    update public.pvp_duels set challenger_progress = greatest(challenger_progress, p_progress)
    where id = p_challenge_id returning * into v_row;
  elsif auth.uid() = v_row.opponent_id then
    update public.pvp_duels set opponent_progress = greatest(opponent_progress, p_progress)
    where id = p_challenge_id returning * into v_row;
  else
    raise exception 'not_a_participant';
  end if;

  return v_row;
end;
$$;
