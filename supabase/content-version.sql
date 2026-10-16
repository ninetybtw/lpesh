-- LexPrep — «версия» учебных материалов, чтобы сайт не скачивал всю базу
-- тем (~6 МБ сжатыми, ~28 МБ данных) при каждом открытии. Выполнить один раз:
--   curl -s https://raw.githubusercontent.com/ninetybtw/lpesh/main/supabase/content-version.sql | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
--   docker restart supabase-rest
--
-- content_version() — короткая строка из числа записей и времени последнего
-- изменения тем, тестов, карточек и практики. content-loader.js хранит её
-- вместе с кэшем в браузере и перекачивает материалы, только если она
-- изменилась (или кэшу больше недели).

-- updated_at у тестов/карточек/практики обновляется при любом изменении
-- (у тем — уже есть свой триггер в content.sql).
create or replace function public.lexprep_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lexprep_touch_topic_quiz on public.topic_quiz;
create trigger lexprep_touch_topic_quiz
  before update on public.topic_quiz
  for each row execute procedure public.lexprep_touch_updated_at();

drop trigger if exists lexprep_touch_topic_flashcards on public.topic_flashcards;
create trigger lexprep_touch_topic_flashcards
  before update on public.topic_flashcards
  for each row execute procedure public.lexprep_touch_updated_at();

drop trigger if exists lexprep_touch_topic_practice on public.topic_practice;
create trigger lexprep_touch_topic_practice
  before update on public.topic_practice
  for each row execute procedure public.lexprep_touch_updated_at();

create or replace function public.content_version()
returns text
language sql
stable
security definer set search_path = public
as $$
  select concat_ws('|',
    (select md5(coalesce(string_agg(id || ':' || title || ':' || sort_order, ',' order by id), '')) from public.disciplines),
    (select count(*) || ':' || coalesce(floor(extract(epoch from max(updated_at)))::bigint, 0) from public.topics),
    (select count(*) || ':' || coalesce(floor(extract(epoch from max(updated_at)))::bigint, 0) from public.topic_quiz),
    (select count(*) || ':' || coalesce(floor(extract(epoch from max(updated_at)))::bigint, 0) from public.topic_flashcards),
    (select count(*) || ':' || coalesce(floor(extract(epoch from max(updated_at)))::bigint, 0) from public.topic_practice)
  );
$$;

revoke all on function public.content_version() from public;
grant execute on function public.content_version() to anon, authenticated;

notify pgrst, 'reload schema';
