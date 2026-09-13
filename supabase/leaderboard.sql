-- LexPrep — Supabase migration: настоящий глобальный рейтинг.
-- Выполнить один раз в SQL Editor, ПОСЛЕ profiles.sql.
--
-- Раньше рейтинг (rating.html) был построен на MOCK_LEADERBOARD —
-- захардкоженным списком выдуманных профилей в leaderboard.js, к которому
-- просто добавлялся текущий пользователь с XP из localStorage. Теперь XP
-- считается на клиенте (см. progress.js:computeXp), но синхронизируется
-- сюда, в profiles.xp, и рейтинг строится реальным запросом ко всем
-- профилям сразу.
--
-- leaderboard_view — отдельная view с security_invoker=false (то есть
-- выполняется с правами владельца, в обход RLS profiles), но отдаёт
-- только безопасные для публичного показа поля (имя, аватар, xp) — email,
-- бан-статус, тариф и т.д. наружу не попадают. Открыта на чтение всем,
-- включая анонимных посетителей (страница рейтинга и так требует логина
-- на фронтенде, но сам API не обязан это дублировать).

alter table public.profiles
  add column if not exists xp integer not null default 0;

drop view if exists public.leaderboard_view;
create view public.leaderboard_view
  with (security_invoker = false)
as
select id, name, avatar_url, xp
from public.profiles
where is_banned = false
order by xp desc;

grant select on public.leaderboard_view to anon, authenticated;
