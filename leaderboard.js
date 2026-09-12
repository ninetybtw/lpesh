/* ==========================================================================
LEADERBOARD.JS — рейтинг пользователей по лигам.

ВАЖНО ДЛЯ БЭКЕНДА: MOCK_LEADERBOARD ниже — демо-заглушка (случайные профили
для примера дизайна). Когда появится бэкенд, нужно:
  1. Удалить MOCK_LEADERBOARD.
  2. Переписать fetchLeaderboard() на реальный запрос, например
     `const res = await fetch('/api/leaderboard'); return await res.json();`
     (сделав саму функцию и её вызовы в rating.js асинхронными).
  3. Каждая запись от API должна иметь ту же форму, что и ниже:
     { id, name, university, xp, avatar }
     — league/level/place считаются на клиенте через LexPrepProgress.getLevelInfo(xp)
       и сортировку по xp, так что бэкенду не нужно самому знать про лиги.
========================================================================== */

const MOCK_LEADERBOARD = [
  { id: 'mock-1', name: 'Дмитрий Волков', university: 'МГУ им. М.В. Ломоносова', xp: 6400, avatar: null },
  { id: 'mock-2', name: 'Алина Соколова', university: 'МГЮА им. О.Е. Кутафина', xp: 5100, avatar: null },
  { id: 'mock-3', name: 'Тимур Раев', university: 'СПбГУ', xp: 4300, avatar: null },
  { id: 'mock-4', name: 'Полина Егорова', university: 'НИУ ВШЭ', xp: 3600, avatar: null },
  { id: 'mock-5', name: 'Игорь Соловьёв', university: 'РГУП', xp: 2900, avatar: null },
  { id: 'mock-6', name: 'Марта Ким', university: 'УрГЮУ им. В.Ф. Яковлева', xp: 2100, avatar: null },
  { id: 'mock-7', name: 'Артём Быков', university: 'МГУ им. М.В. Ломоносова', xp: 1450, avatar: null },
  { id: 'mock-8', name: 'Ольга Панина', university: 'СГЮА', xp: 820, avatar: null },
  { id: 'mock-9', name: 'Роман Гусев', university: 'КФУ', xp: 340, avatar: null }
];

function fetchLeaderboard() {
  const entries = MOCK_LEADERBOARD.map(u => ({ ...u, isCurrentUser: false }));

  const currentUser = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (currentUser && typeof LexPrepProgress !== 'undefined') {
    const gamification = LexPrepProgress.getGamification();
    entries.push({
      id: 'current-user',
      name: currentUser.name || 'Без имени',
      university: currentUser.university || 'Вуз не указан',
      xp: gamification.xp,
      avatar: currentUser.avatar || null,
      isCurrentUser: true
    });
  }

  entries.sort((a, b) => b.xp - a.xp);

  return entries.map((entry, index) => ({
    ...entry,
    place: index + 1,
    ...LexPrepProgress.getLevelInfo(entry.xp)
  }));
}
