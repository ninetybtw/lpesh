-- LexPrep — синхронизация прогресса между устройствами. Выполнить один раз:
--   curl -s https://raw.githubusercontent.com/ninetybtw/lpesh/main/supabase/progress-sync.sql | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
--   docker restart supabase-rest
--
-- Опыт, уровень, монеты, карточки, попытки тестов, прочитанные конспекты,
-- заметки и т.п. считаются на устройстве из localStorage. Без синхронизации
-- на телефоне и компьютере одного аккаунта были разные уровни. Теперь сайт
-- (account-scope.js) при каждом открытии и после изменений сливает
-- локальные данные с этой строкой и сохраняет результат обратно:
-- занятия с разных устройств складываются.
--
-- data   — { "<ключ localStorage>": "<значение>" }
-- mtimes — { "<ключ>": <время изменения, мс> } для выбора более свежего.

create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  mtimes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_progress enable row level security;

drop policy if exists "Users read own progress" on public.user_progress;
create policy "Users read own progress"
  on public.user_progress for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own progress" on public.user_progress;
create policy "Users insert own progress"
  on public.user_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own progress" on public.user_progress;
create policy "Users update own progress"
  on public.user_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.user_progress to authenticated;

notify pgrst, 'reload schema';
