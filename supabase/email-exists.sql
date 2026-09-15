-- RPC для формы «Забыли пароль»: проверяет, есть ли аккаунт с таким email,
-- чтобы можно было показать явную ошибку "такой почты нет" вместо
-- стандартного молчаливого поведения Supabase Auth (не палит существование
-- аккаунтов). Осознанный выбор продукта — раскрывает существование email,
-- принят по явной просьбе.
create or replace function public.email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from auth.users where lower(email) = lower(p_email)
  );
$$;

grant execute on function public.email_exists(text) to anon, authenticated;
