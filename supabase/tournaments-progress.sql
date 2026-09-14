-- LexPrep — Supabase migration: быстрый переход к следующему вопросу в
-- турнирных матчах, если ответили оба (аналогично duels-progress.sql).
-- Выполнить один раз, ПОСЛЕ tournaments.sql.

alter table public.tournament_matches
  add column if not exists player1_progress integer not null default 0,
  add column if not exists player2_progress integer not null default 0;

create or replace function public.tournament_match_advance_progress(p_match_id uuid, p_progress integer)
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
  if v_row.status <> 'active' then
    raise exception 'match_not_active';
  end if;

  perform set_config('lexprep.trusted_rpc', 'true', true);
  if auth.uid() = v_row.player1_id then
    update public.tournament_matches set player1_progress = greatest(player1_progress, p_progress)
    where id = p_match_id returning * into v_row;
  elsif auth.uid() = v_row.player2_id then
    update public.tournament_matches set player2_progress = greatest(player2_progress, p_progress)
    where id = p_match_id returning * into v_row;
  else
    raise exception 'not_a_participant';
  end if;

  return v_row;
end;
$$;
