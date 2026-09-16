-- LexPrep — денормализует имя принявшего вызов (opponent_name), той же
-- логикой, что challenger_name уже был денормализован в
-- duels-progress.sql. Нужно для подробного итога дуэли (кто с кем
-- играл — см. duel-pvp.js). Выполнить один раз в SQL Editor, ПОСЛЕ
-- duels-tournaments-robustness.sql.

alter table public.pvp_duels add column if not exists opponent_name text;

create or replace function public.duel_accept_challenge(p_challenge_id uuid)
returns public.pvp_duels
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.pvp_duels;
  v_challenger_rating integer;
  v_opponent_rating integer;
  v_opponent_name text;
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
  select duel_rating, name into v_opponent_rating, v_opponent_name from public.profiles where id = auth.uid();

  perform set_config('lexprep.trusted_rpc', 'true', true);
  update public.pvp_duels
  set opponent_id = auth.uid(),
      opponent_name = coalesce(v_opponent_name, 'Игрок'),
      status = 'accepted',
      challenger_rating_before = coalesce(v_challenger_rating, 1000),
      opponent_rating_before = coalesce(v_opponent_rating, 1000)
  where id = p_challenge_id
  returning * into v_row;

  return v_row;
end;
$$;
