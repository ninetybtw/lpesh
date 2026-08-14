-- LexPrep — Supabase migration: реальный контент (конспекты по темам),
-- вместо части, до сих пор захардкоженной в data.js. Выполнить один раз
-- в SQL Editor, ПОСЛЕ ai-consultant.sql.
--
-- Читать может кто угодно (в т.ч. без входа — конспект открыт как часть
-- воронки на сайте, так же как сейчас data.js грузится без проверки
-- авторизации). Писать/менять может только админ — переиспользуем
-- public.is_admin() из admin.sql.
--
-- Контент темы хранится как markdown (body_markdown) — рендерится в HTML
-- на фронтенде через vendor/marked.min.js (content-loader.js), а не
-- хранится готовым HTML: так можно грузить конспекты почти как есть,
-- без ручной вёрстки каждой темы.

create table if not exists public.disciplines (
  id text primary key,
  title text not null,
  sort_order integer not null default 0
);

alter table public.disciplines enable row level security;

drop policy if exists "Anyone can view disciplines" on public.disciplines;
create policy "Anyone can view disciplines"
  on public.disciplines for select
  using (true);

drop policy if exists "Admins can manage disciplines" on public.disciplines;
create policy "Admins can manage disciplines"
  on public.disciplines for all
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.topics (
  id text primary key,
  discipline_id text not null references public.disciplines(id) on delete cascade,
  topic_number integer,
  title text not null,
  section text,
  body_markdown text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.topics enable row level security;

drop policy if exists "Anyone can view topics" on public.topics;
create policy "Anyone can view topics"
  on public.topics for select
  using (true);

drop policy if exists "Admins can manage topics" on public.topics;
create policy "Admins can manage topics"
  on public.topics for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.set_topic_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_topics_updated_at on public.topics;
create trigger set_topics_updated_at
  before update on public.topics
  for each row execute procedure public.set_topic_updated_at();
