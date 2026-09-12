-- LexPrep — Supabase migration: тесты, карточки и практика ВС РФ по темам.
-- Выполнить один раз в SQL Editor, ПОСЛЕ content.sql.
--
-- Храним контент "как прислали" (сырой JSON — вопросы с id вариантов,
-- позиции Пленумов и т.п.), а под форму, которую уже понимает фронтенд
-- (topic.test/topic.cards/topic.practice в LEXPREP_DATA), конвертируем
-- на лету в content-loader.js. Так при правках/новых темах не нужно
-- трогать схему БД — только сам JSON.

create table if not exists public.topic_quiz (
  topic_id text primary key references public.topics(id) on delete cascade,
  questions jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.topic_quiz enable row level security;

drop policy if exists "Anyone can view topic_quiz" on public.topic_quiz;
create policy "Anyone can view topic_quiz"
  on public.topic_quiz for select
  using (true);

drop policy if exists "Admins can manage topic_quiz" on public.topic_quiz;
create policy "Admins can manage topic_quiz"
  on public.topic_quiz for all
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.topic_flashcards (
  topic_id text primary key references public.topics(id) on delete cascade,
  cards jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.topic_flashcards enable row level security;

drop policy if exists "Anyone can view topic_flashcards" on public.topic_flashcards;
create policy "Anyone can view topic_flashcards"
  on public.topic_flashcards for select
  using (true);

drop policy if exists "Admins can manage topic_flashcards" on public.topic_flashcards;
create policy "Admins can manage topic_flashcards"
  on public.topic_flashcards for all
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.topic_practice (
  topic_id text primary key references public.topics(id) on delete cascade,
  acts jsonb not null default '[]'::jsonb,
  case_law jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.topic_practice enable row level security;

drop policy if exists "Anyone can view topic_practice" on public.topic_practice;
create policy "Anyone can view topic_practice"
  on public.topic_practice for select
  using (true);

drop policy if exists "Admins can manage topic_practice" on public.topic_practice;
create policy "Admins can manage topic_practice"
  on public.topic_practice for all
  using (public.is_admin())
  with check (public.is_admin());
