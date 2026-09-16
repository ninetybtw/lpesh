-- LexPrep — добавляет уровень/рейтинг создателя дуэли, чтобы показывать
-- их в списке открытых вызовов (ник уже был, теперь плюс уровень и
-- дуэльный рейтинг на момент создания вызова).
-- Выполнить один раз в SQL Editor, ПОСЛЕ duels-progress.sql.
alter table public.pvp_duels add column if not exists challenger_level integer;
alter table public.pvp_duels add column if not exists challenger_rating integer;

-- Пересоздаём enforce_pvp_duel_update() с новыми полями в списке того, что
-- сохраняется при отмене своего же открытого вызова — иначе challenger_id
-- отмены (единственное разрешённое клиенту изменение) заодно обнулил бы
-- challenger_level/challenger_rating, так как они не были в списке old.*.
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
    new.challenger_level := old.challenger_level;
    new.challenger_rating := old.challenger_rating;
    new.created_at := old.created_at;
    new.completed_at := old.completed_at;
    return new;
  end if;

  raise exception 'not_allowed';
end;
$$;
