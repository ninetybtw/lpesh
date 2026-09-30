-- LexPrep — Supabase migration: раздел «Библиотека» (library.html) —
-- сборники билетов по дисциплинам, которые можно читать только на сайте
-- и только с действующим тарифом «Про» или «Максимум».
-- Выполнить один раз в SQL Editor, ПОСЛЕ profiles.sql, admin.sql и
-- plan-billing-period.sql (нужны plan_tier/plan_expires_at/is_admin/
-- is_banned на profiles и функция public.is_admin()).
--
-- Как устроена защита
-- -------------------
-- Каталог (сборники и оглавление: номер, название, разделы билета) виден
-- всем, в том числе без входа: это витрина, по ней видно, что откроет
-- подписка. Сам текст билета и схемы лежат в отдельных таблицах, которые
-- обычный пользователь не может прочитать напрямую никаким select'ом
-- (RLS пускает только админа). Текст отдаётся только через
-- public.library_read_item(id): функция сама проверяет по profiles, что
-- тариф «Про»/«Максимум» действует прямо сейчас (не по localStorage — там
-- тариф можно «выдать» себе руками), отдаёт ОДИН билет за вызов и
-- считает прочитанные билеты: не больше LIBRARY_DAILY_LIMIT разных
-- билетов в сутки на человека. Так весь сборник нельзя выгрузить одним
-- запросом или скриптом за минуту, а обычному чтению лимит не мешает.
--
-- Файлов (PDF, DOCX, картинок по прямой ссылке) в разделе нет вообще:
-- билет показывается как текст внутри страницы, кнопки «Скачать» нет,
-- копирование/печать/сохранение страницы на фронтенде заблокированы, а
-- поверх текста — водяной знак с email читателя (library.js). Поэтому
-- сборники в PDF нужно загружать не файлом, а текстом (content_html или
-- content_md по билетам) — иначе PDF можно было бы просто скачать.
--
-- Как загружать контент (для импорт-скриптов, supabase/content-scripts)
-- ---------------------------------------------------------------------
-- Импорт — как у конспектов: скрипт логинится админ-аккаунтом и пишет
-- обычными insert/upsert (у админа полный доступ ко всем таблицам ниже).
--   1. library_collections — одна строка на сборник:
--        id 'criminal-law-tickets', discipline_id 'criminal-law' (тот же id,
--        что в public.disciplines), discipline_title 'Уголовное право',
--        title 'Билеты по уголовному праву', author, description, kind.
--   2. library_items — оглавление, одна строка на билет/тему:
--        id '<collection_id>-01', collection_id, number, title,
--        part ('Общая часть' / 'Особенная часть' / null), sections
--        ([{ "id": "22.1", "title": "..." }]), word_count, sort_order.
--   3. library_item_content — текст билета, строка на каждый item:
--        content_html (приоритетнее) и/или content_md, footnotes
--        ([{ "n": 1, "md": "..." }]), images — список путей схем,
--        которые встречаются в тексте (['assets/p128_0.png']).
--   4. library_assets — сами схемы, base64 без префикса data:, по пути из
--        images; сопоставление с <img src> в тексте — по имени файла.
-- item_count/word_count у сборника заполнять не нужно: число билетов и
-- время чтения страница считает сама по library_items.
--
-- В SQL Editor Supabase: вставить файл целиком в новую вкладку, ничего не
-- выделять, Run. На предупреждение Studio о «destructive operations» и
-- RLS выбрать запуск как есть: drop ... if exists удаляют только политики
-- и триггеры с этими же именами перед пересозданием (данные не трогают),
-- а RLS включается сразу после каждой таблицы.

create table if not exists public.library_collections (
  id text primary key,
  discipline_id text,
  discipline_title text not null,
  title text not null,
  kind text not null default 'tickets' check (kind in ('tickets', 'lectures', 'course', 'other')),
  author text,
  description text,
  actualized boolean not null default false,
  is_published boolean not null default true,
  item_count integer not null default 0,
  word_count integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.library_collections enable row level security;

create table if not exists public.library_items (
  id text primary key,
  collection_id text not null references public.library_collections(id) on delete cascade,
  number integer not null,
  title text not null,
  part text,
  sections jsonb not null default '[]'::jsonb,
  word_count integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.library_items enable row level security;

create index if not exists library_items_collection_idx on public.library_items(collection_id, sort_order, number);

create table if not exists public.library_item_content (
  item_id text primary key references public.library_items(id) on delete cascade,
  content_html text,
  content_md text,
  footnotes jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.library_item_content enable row level security;

create table if not exists public.library_assets (
  collection_id text not null references public.library_collections(id) on delete cascade,
  path text not null,
  mime_type text not null default 'image/png',
  data_base64 text not null,
  primary key (collection_id, path)
);

alter table public.library_assets enable row level security;

-- Кто какие билеты открывал и когда — для суточного лимита.
create table if not exists public.library_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.library_items(id) on delete cascade,
  day date not null default current_date,
  read_at timestamptz not null default now(),
  primary key (user_id, item_id, day)
);

alter table public.library_reads enable row level security;

create index if not exists library_reads_user_day_idx on public.library_reads(user_id, day);

-- Каталог и оглавление — витрина, видны всем.
drop policy if exists "Anyone can view published library collections" on public.library_collections;
create policy "Anyone can view published library collections"
  on public.library_collections for select
  using (is_published or public.is_admin());

drop policy if exists "Anyone can view published library items" on public.library_items;
create policy "Anyone can view published library items"
  on public.library_items for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.library_collections c
      where c.id = collection_id and c.is_published
    )
  );

-- Текст и схемы — напрямую только админу; остальным через
-- library_read_item ниже.
drop policy if exists "Admins can manage library collections" on public.library_collections;
create policy "Admins can manage library collections"
  on public.library_collections for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage library items" on public.library_items;
create policy "Admins can manage library items"
  on public.library_items for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage library content" on public.library_item_content;
create policy "Admins can manage library content"
  on public.library_item_content for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage library assets" on public.library_assets;
create policy "Admins can manage library assets"
  on public.library_assets for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can view own library reads" on public.library_reads;
create policy "Users can view own library reads"
  on public.library_reads for select
  using (auth.uid() = user_id or public.is_admin());

-- updated_at обновляется сам.
create or replace function public.library_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists library_collections_touch on public.library_collections;
create trigger library_collections_touch
  before update on public.library_collections
  for each row execute procedure public.library_touch_updated_at();

drop trigger if exists library_items_touch on public.library_items;
create trigger library_items_touch
  before update on public.library_items
  for each row execute procedure public.library_touch_updated_at();

drop trigger if exists library_item_content_touch on public.library_item_content;
create trigger library_item_content_touch
  before update on public.library_item_content
  for each row execute procedure public.library_touch_updated_at();

-- Раньше здесь был триггер пересчёта item_count/word_count — не нужен:
-- страница считает билеты и время чтения сама по library_items.
drop trigger if exists library_items_recount on public.library_items;
drop function if exists public.library_recount_collection();

-- Доступ к тексту: админ — всегда; остальные — действующий серверный
-- тариф «Про»/«Максимум» и не заблокирован. Тариф, «купленный» в
-- магазине за монеты, живёт только в localStorage браузера (shop.js) —
-- сервер о нём не знает, и библиотеку он не открывает.
create or replace function public.has_library_access()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select p.is_admin
        or (
          not coalesce(p.is_banned, false)
          and p.plan_tier in ('pro', 'max')
          and p.plan_expires_at is not null
          and p.plan_expires_at > now()
        )
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

-- Сколько разных билетов можно открыть за сутки. Повторное открытие уже
-- прочитанного сегодня билета лимит не тратит.
create or replace function public.library_daily_limit()
returns integer
language sql
immutable
as $$
  select 60;
$$;

create or replace function public.library_status()
returns jsonb
language plpgsql
security definer set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_reads integer := 0;
begin
  if v_uid is not null then
    select count(*) into v_reads
    from public.library_reads
    where user_id = v_uid and day = current_date;
  end if;
  return jsonb_build_object(
    'authenticated', v_uid is not null,
    'has_access', public.has_library_access(),
    'is_admin', public.is_admin(),
    'reads_today', v_reads,
    'daily_limit', public.library_daily_limit()
  );
end;
$$;

create or replace function public.library_read_item(p_item_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_item public.library_items%rowtype;
  v_content public.library_item_content%rowtype;
  v_published boolean;
  v_reads integer;
  v_assets jsonb;
begin
  if v_uid is null then
    raise exception 'library_auth_required';
  end if;
  if not public.has_library_access() then
    raise exception 'library_plan_required';
  end if;

  select * into v_item from public.library_items where id = p_item_id;
  if not found then
    raise exception 'library_item_not_found';
  end if;

  select is_published into v_published from public.library_collections where id = v_item.collection_id;
  if not coalesce(v_published, false) and not v_is_admin then
    raise exception 'library_item_not_found';
  end if;

  if not v_is_admin and not exists (
    select 1 from public.library_reads
    where user_id = v_uid and item_id = p_item_id and day = current_date
  ) then
    select count(*) into v_reads
    from public.library_reads
    where user_id = v_uid and day = current_date;
    if v_reads >= public.library_daily_limit() then
      raise exception 'library_daily_limit';
    end if;
    insert into public.library_reads (user_id, item_id) values (v_uid, p_item_id)
    on conflict do nothing;
  end if;

  select * into v_content from public.library_item_content where item_id = p_item_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'path', a.path,
           'mime', a.mime_type,
           'data', a.data_base64
         )), '[]'::jsonb)
  into v_assets
  from public.library_assets a
  where a.collection_id = v_item.collection_id
    and a.path in (select jsonb_array_elements_text(coalesce(v_content.images, '[]'::jsonb)));

  return jsonb_build_object(
    'id', v_item.id,
    'collection_id', v_item.collection_id,
    'number', v_item.number,
    'title', v_item.title,
    'part', v_item.part,
    'sections', v_item.sections,
    'word_count', v_item.word_count,
    'content_html', v_content.content_html,
    'content_md', v_content.content_md,
    'footnotes', coalesce(v_content.footnotes, '[]'::jsonb),
    'assets', v_assets,
    'updated_at', coalesce(v_content.updated_at, v_item.updated_at)
  );
end;
$$;

revoke all on function public.library_read_item(text) from public, anon;
grant execute on function public.library_read_item(text) to authenticated;
grant execute on function public.library_status() to anon, authenticated;
