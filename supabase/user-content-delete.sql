-- LexPrep — Supabase migration: удаление пользовательских тестов/статей.
-- Выполнить один раз в SQL Editor, ПОСЛЕ moderator.sql.
--
-- До этого момента у public.user_tests/public.user_articles не было
-- delete-политики вообще — ни автор, ни модератор/админ не могли удалить
-- запись (только сменить status на rejected). Добавляем: автор может
-- удалить свой тест/статью в любом статусе (например, уже
-- неактуальный или случайно опубликованный), модератор/админ — любой
-- чужой (спам, недопустимый контент).

drop policy if exists "Users can delete own tests" on public.user_tests;
create policy "Users can delete own tests"
  on public.user_tests for delete
  using (auth.uid() = user_id or public.is_admin() or public.is_moderator());

drop policy if exists "Users can delete own articles" on public.user_articles;
create policy "Users can delete own articles"
  on public.user_articles for delete
  using (auth.uid() = user_id or public.is_admin() or public.is_moderator());
