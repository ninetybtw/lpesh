-- LexPrep — начало билета без подписки. Выполнить один раз, ПОСЛЕ library.sql:
--   curl -s https://raw.githubusercontent.com/ninetybtw/lpesh/main/supabase/library-preview.sql | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
--   docker restart supabase-rest
--
-- library_preview_item(id) отдаёт любому посетителю (и без входа) примерно
-- первую треть билета, но не больше ~4000 символов разметки и никогда не
-- больше половины. Режется по концу абзаца, списка, таблицы или врезки.
-- Остальной текст, схемы и сноски из закрытой части с сервера не уходят
-- вообще, поэтому вытащить их из кода страницы нельзя. Чтения по превью
-- не считаются в суточный лимит и не отмечаются прочитанными.
--
-- Сколько открывать — меняется в library_preview_cut (доля и потолок).

create or replace function public.library_preview_cut(p_text text, p_is_md boolean)
returns text
language plpgsql
immutable
as $$
declare
  v_len integer := coalesce(length(p_text), 0);
  v_target integer;
  v_end constant text := '</(?:p|li|ul|ol|table|pre|blockquote|div|h[1-6]|dl)>';
  v_head text;
  v_tail text;
  v_out text;
begin
  if v_len = 0 then
    return '';
  end if;
  v_target := least(round(v_len * 0.30)::integer, 4000);
  v_head := substr(p_text, 1, v_target);
  v_tail := substr(p_text, v_target + 1);

  if p_is_md then
    -- Markdown: до конца абзаца после точки отсечения.
    v_out := v_head || coalesce(substring(v_tail from '^(.*?\n\n)'), '');
    if length(v_out) > v_len / 2 then
      v_out := coalesce(substring(v_head from '^(.*\n\n)'), '');
    end if;
    return v_out;
  end if;

  -- HTML: дорезаем до ближайшего закрывающего блочного тега. Незакрытые
  -- внешние теги (список, врезка) браузер закроет сам.
  v_out := v_head || coalesce(substring(v_tail from '^(.*?' || v_end || ')'), '');
  if v_out = v_head or length(v_out) > v_len / 2 then
    -- Иначе — по последнему концу блока до точки отсечения.
    v_out := coalesce(substring(v_head from '^(.*' || v_end || ')'), '');
  end if;
  -- Схемы в превью не отдаём.
  return regexp_replace(v_out, '<img[^>]*>', '', 'gi');
end;
$$;

create or replace function public.library_preview_item(p_item_id text)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_item public.library_items%rowtype;
  v_content public.library_item_content%rowtype;
  v_published boolean;
  v_is_md boolean;
  v_preview text;
  v_footnotes jsonb;
begin
  select * into v_item from public.library_items where id = p_item_id;
  if not found then
    raise exception 'library_item_not_found';
  end if;
  select is_published into v_published from public.library_collections where id = v_item.collection_id;
  if not coalesce(v_published, false) and not public.is_admin() then
    raise exception 'library_item_not_found';
  end if;

  select * into v_content from public.library_item_content where item_id = p_item_id;
  v_is_md := coalesce(v_content.content_html, '') = '';
  v_preview := public.library_preview_cut(
    case when v_is_md then v_content.content_md else v_content.content_html end, v_is_md);

  -- Только сноски, на которые есть ссылки в открытой части.
  select coalesce(jsonb_agg(f order by (f->>'n')::numeric), '[]'::jsonb)
  into v_footnotes
  from jsonb_array_elements(coalesce(v_content.footnotes, '[]'::jsonb)) f
  where f->>'n' is not null
    and (position('>' || (f->>'n') || '</sup>' in v_preview) > 0
      or position('[^' || (f->>'n') || ']' in v_preview) > 0);

  return jsonb_build_object(
    'id', v_item.id,
    'collection_id', v_item.collection_id,
    'number', v_item.number,
    'title', v_item.title,
    'part', v_item.part,
    'sections', v_item.sections,
    'word_count', v_item.word_count,
    'content_html', case when v_is_md then null else v_preview end,
    'content_md', case when v_is_md then v_preview else null end,
    'footnotes', v_footnotes,
    'assets', '[]'::jsonb,
    'preview', true,
    'updated_at', coalesce(v_content.updated_at, v_item.updated_at)
  );
end;
$$;

revoke all on function public.library_preview_item(text) from public;
grant execute on function public.library_preview_item(text) to anon, authenticated;

notify pgrst, 'reload schema';
