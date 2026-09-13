/* ==========================================================================
LEADERBOARD.JS — рейтинг пользователей по лигам.
Реальные данные из public.leaderboard_view (см. supabase/leaderboard.sql и
api.js:fetchLeaderboard) — XP синхронизируется туда из progress.js при
каждом level-up. Никаких выдуманных профилей, только реальные аккаунты.
========================================================================== */

async function fetchLeaderboard() {
  if (typeof LexPrepApi === 'undefined') return [];

  const rows = await LexPrepApi.fetchLeaderboard();
  const currentUser = JSON.parse(localStorage.getItem('lexprep_user') || 'null');

  const entries = rows.map(r => ({
    id: r.id,
    name: r.name,
    avatar: r.avatar,
    xp: r.xp,
    isCurrentUser: !!currentUser && r.id === currentUser.id
  }));

  entries.sort((a, b) => b.xp - a.xp);

  return entries.map((entry, index) => ({
    ...entry,
    place: index + 1,
    ...LexPrepProgress.getLevelInfo(entry.xp)
  }));
}
