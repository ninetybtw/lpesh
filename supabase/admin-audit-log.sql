-- LexPrep — Supabase migration: журнал действий админов и модераторов.
-- Выполнить один раз в SQL Editor, ПОСЛЕ moderator.sql.
--
-- Каждое админ/модераторское действие (бан, начисление монет, выдача
-- тарифа/роли, публикация или отклонение теста/статьи, ответ в
-- поддержке/предложениях, удаление аккаунта или контента) пишется сюда
-- фронтендом (см. api.js: logAdminAction) сразу после успешного
-- изменения — чтобы при спорной ситуации админ мог посмотреть, кто из
-- модераторов что именно сделал и когда.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  actor_name text,
  actor_role text not null check (actor_role in ('admin', 'moderator')),
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  target_label text,
  details text,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

-- Видит журнал только админ — модератор не должен иметь возможность
-- изучить/скрыть следы других модераторов.
drop policy if exists "Admins can view audit log" on public.admin_audit_log;
create policy "Admins can view audit log"
  on public.admin_audit_log for select
  using (public.is_admin());

-- Писать может любой админ/модератор, но только запись о СЕБЕ как
-- авторе — подделать чужую подпись под своим действием нельзя.
drop policy if exists "Admins and moderators can log own actions" on public.admin_audit_log;
create policy "Admins and moderators can log own actions"
  on public.admin_audit_log for insert
  with check (
    actor_id = auth.uid()
    and (public.is_admin() or public.is_moderator())
  );

-- Никаких update/delete-политик нарочно не создаём — журнал
-- неизменяемый (нет RLS-разрешения, значит операция запрещена всем,
-- включая владельца строки).
