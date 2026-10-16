-- LexPrep — проверка имени пользователя на сервере и статус почты в админке.
-- Выполнить один раз, ПОСЛЕ trial.sql:
--   curl -s https://raw.githubusercontent.com/ninetybtw/lpesh/main/supabase/name-check.sql | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
--   docker restart supabase-rest
--
-- 1. lexprep_name_problem(имя) — текст ошибки или null, если имя подходит.
--    Те же правила, что в validation.js (checkDisplayName): мат, в том числе
--    замаскированный латиницей, цифрами и разделителями, оскорбления,
--    служебные имена, бессмыслица («а что такок», «фываолдж», «qwerty»).
--    Меняешь списки слов здесь — поменяй и в validation.js.
-- 2. Триггер на profiles: при смене имени сервер отклоняет недопустимое
--    (ошибка invalid_name, текст в detail). При регистрации вход не
--    ломается — недопустимое имя заменяется на «Студент XXXX». Админам
--    можно задавать любое имя.
-- 3. admin_users_auth_info() — подтвердил ли пользователь почту и когда
--    входил последний раз (для колонки «Статус» в админке).
--
-- Посмотреть, у кого уже сейчас недопустимое имя:
--   select id, name, email from public.profiles where public.lexprep_name_problem(name) is not null;
-- Переименовать их всех в «Студент XXXX» (по желанию):
--   update public.profiles set name = 'Студент ' || upper(substr(replace(id::text, '-', ''), 1, 4))
--   where public.lexprep_name_problem(name) is not null;

create or replace function public.lexprep_name_problem(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_not_a_name constant text := 'Похоже не на имя. Укажи своё имя или никнейм — например, «Анна» или «Lex_Student».';
  v_roots constant text := '(хуй|хуе|хуя|хуи|хую|хуы|пизд|пезд|бляд|блят|ебан|ебал|ебат|ебуч|ебну|ебло|ебаш|еблан|ебет|ебут|ебис|долбое|заеб|выеб|поеб|наеб|отъеб|уеб|съеб|въеб|мудак|мудил|мудоз|пидор|пидар|пидр|гандон|гондон|залуп|шлюх|шалав|дроч|сучар|гитлер|нацис)';
  v_words constant text[] := array['бля','сука','суки','суку','хер','херня','нахер','похер','жопа','жопу','жопе','манда',
    'мразь','мрази','тварь','урод','дебил','идиот','даун','лох','член','пенис','говно','говна','срать','ссать','секс','порно'];
  v_latin constant text := '(fuck|shit|bitch|cunt|pussy|whore|nigg|hitler|nazi)';
  v_latin_words constant text[] := array['dick','sex','porn','fck','wtf'];
  v_reserved constant text := '(admin|админ|модератор|moderator|lexprep|лекспреп|поддержк|support)';
  v_not_names constant text[] := array['что','чо','чё','шо','как','кто','где','это','эта','этот','такое','такой','такок','почему',
    'зачем','когда','куда','привет','здравствуйте','пока','хз','лол','кек','ок','окей','нет','да','ну','вот','тест','тестовый',
    'test','qwerty','asdf','имя','никнейм','name','nickname','user','юзер','пользователь','аноним','anon','noname',
    'неизвестный','просто','вообще','хм','ааа','ыыы','abc','абв'];
  v_lower text;
  v_homo text;
  v_tr text;
  v_variant text;
  v_word text;
  v_part text;
  v_letters text;
  v_lw text;
  v_parts text[];
begin
  if char_length(v_name) < 2 or char_length(v_name) > 24 or v_name !~ '^[A-Za-zА-Яа-яЁё0-9 .''_-]+$' then
    return 'Имя — от 2 до 24 символов: буквы, цифры, пробел, дефис, точка или подчёркивание.';
  end if;
  if char_length(regexp_replace(v_name, '[^A-Za-zА-Яа-яЁё]', '', 'g')) < 2 then
    return 'В имени должно быть хотя бы две буквы.';
  end if;

  v_lower := replace(lower(v_name), 'ё', 'е');
  -- Латинские буквы и цифры, похожие на русские: x→х, 0→о, 6→б…
  v_homo := translate(v_lower, 'abcehkmoptxyu01346@', 'абсенкмортхууоизчба');
  -- Транслит: pizda → пизда, hui → хуи.
  v_tr := v_lower;
  v_tr := replace(v_tr, 'shch', 'щ'); v_tr := replace(v_tr, 'sch', 'щ'); v_tr := replace(v_tr, 'yo', 'е');
  v_tr := replace(v_tr, 'zh', 'ж'); v_tr := replace(v_tr, 'kh', 'х'); v_tr := replace(v_tr, 'ts', 'ц');
  v_tr := replace(v_tr, 'ch', 'ч'); v_tr := replace(v_tr, 'sh', 'ш'); v_tr := replace(v_tr, 'ya', 'я');
  v_tr := replace(v_tr, 'yu', 'ю');
  v_tr := translate(v_tr, 'abvgdezijklmnoprstufhxcwyq', 'абвгдезийклмнопрстуфххквык');

  foreach v_variant in array array[v_lower, v_homo, v_tr] loop
    -- Без разделителей и повторов букв: «х у у й» → «хуй».
    if regexp_replace(regexp_replace(v_variant, '[^a-zа-я]', '', 'g'), '(.)\1+', '\1', 'g') ~ v_roots then
      return 'В имени есть недопустимые слова — выбери другое.';
    end if;
    foreach v_word in array regexp_split_to_array(v_variant, '[\s._''-]+') loop
      if v_word = any(v_words) or regexp_replace(v_word, '(.)\1+', '\1', 'g') = any(v_words) then
        return 'В имени есть недопустимые слова — выбери другое.';
      end if;
    end loop;
  end loop;
  if regexp_replace(regexp_replace(v_lower, '[^a-zа-я]', '', 'g'), '(.)\1+', '\1', 'g') ~ v_latin then
    return 'В имени есть недопустимые слова — выбери другое.';
  end if;
  foreach v_word in array regexp_split_to_array(v_lower, '[\s._''-]+') loop
    if v_word = any(v_latin_words) then
      return 'В имени есть недопустимые слова — выбери другое.';
    end if;
  end loop;
  if regexp_replace(regexp_replace(v_lower, '[^a-zа-я]', '', 'g'), '(.)\1+', '\1', 'g') ~ v_reserved
     or regexp_replace(regexp_replace(v_homo, '[^a-zа-я]', '', 'g'), '(.)\1+', '\1', 'g') ~ v_reserved then
    return 'Это имя зарезервировано — выбери другое.';
  end if;

  v_parts := string_to_array(v_name, ' ');
  if array_length(v_parts, 1) > 3 then
    return v_not_a_name;
  end if;
  foreach v_part in array v_parts loop
    v_letters := regexp_replace(v_part, '[^A-Za-zА-Яа-яЁё]', '', 'g');
    v_lw := replace(lower(v_letters), 'ё', 'е');
    if v_letters ~ '[A-Za-z]' and v_letters ~ '[А-Яа-яЁё]' then
      return 'В одном слове смешаны русские и латинские буквы — исправь имя.';
    end if;
    if char_length(v_letters) = 1 and v_part !~ '^[A-Za-zА-Яа-яЁё]\.$' then
      return v_not_a_name;
    end if;
    if v_lw = any(v_not_names) or v_lw ~ '(.)\1\1' then
      return v_not_a_name;
    end if;
    if char_length(v_lw) >= 4 and v_lw !~ '[аеиоуыэюяaeiouy]' then
      return v_not_a_name;
    end if;
    if v_lw ~ '[бвгджзйклмнпрстфхцчшщ]{6,}' or v_lw ~ '[bcdfghjklmnpqrstvwxz]{7,}' then
      return v_not_a_name;
    end if;
    if exists (
      select 1
      from unnest(array['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']) as r(row_keys),
           generate_series(1, char_length(r.row_keys) - 3) as g(i)
      where substr(r.row_keys, g.i, 4) <> all(array['апро', 'прол', 'смит', 'мить', 'erty', 'укен'])
        and position(substr(r.row_keys, g.i, 4) in v_lw) > 0
    ) then
      return v_not_a_name;
    end if;
  end loop;
  return null;
end;
$$;

grant execute on function public.lexprep_name_problem(text) to anon, authenticated;

create or replace function public.check_profile_name()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_problem text;
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then
    return new;
  end if;
  new.name := regexp_replace(btrim(coalesce(new.name, '')), '\s+', ' ', 'g');
  v_problem := public.lexprep_name_problem(new.name);
  if v_problem is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Регистрацию не ломаем: недопустимое имя просто заменяем.
    new.name := 'Студент ' || upper(substr(replace(new.id::text, '-', ''), 1, 4));
    return new;
  end if;
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  raise exception 'invalid_name' using detail = v_problem;
end;
$$;

drop trigger if exists check_profile_name on public.profiles;
create trigger check_profile_name
  before insert or update of name on public.profiles
  for each row execute procedure public.check_profile_name();

create or replace function public.admin_users_auth_info()
returns table (id uuid, email_confirmed_at timestamptz, last_sign_in_at timestamptz)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not (public.is_admin() or public.is_moderator()) then
    raise exception 'not_allowed';
  end if;
  return query
    select u.id, u.email_confirmed_at, u.last_sign_in_at from auth.users u;
end;
$$;

revoke all on function public.admin_users_auth_info() from public, anon;
grant execute on function public.admin_users_auth_info() to authenticated;

notify pgrst, 'reload schema';
