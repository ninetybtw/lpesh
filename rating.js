/* ==========================================================================
RATING.JS — рендер страницы рейтинга. Логика данных живёт в leaderboard.js.
Страница: карточка «моё место» (сколько XP до следующего места и лиги),
пьедестал топ-3, фильтр по лигам и список остальных участников.
========================================================================== */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatXp(xp) {
  return Number(xp || 0).toLocaleString('ru-RU');
}

function ratingAvatar(entry, className, frameClass) {
  const initial = (entry.name || 'U').trim().charAt(0).toUpperCase();
  const style = entry.avatar
    ? `style="background-image:url(${escapeHtml(entry.avatar)});background-size:cover;background-position:center;"`
    : '';
  return `<span class="${className} ${frameClass || ''}" ${style}>${entry.avatar ? '' : escapeHtml(initial)}</span>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }

  if (typeof LexPrepProgress === 'undefined' || typeof fetchLeaderboard === 'undefined') return;

  const legendEl = document.getElementById('ratingLegend');
  const listEl = document.getElementById('ratingList');
  const meEl = document.getElementById('ratingMe');
  const podiumEl = document.getElementById('ratingPodium');
  const motion = window.LexPrepMotion;
  const equippedFrame = localStorage.getItem('lexprep_shop_equipped');
  const frameFor = (entry) => (entry.isCurrentUser && equippedFrame && equippedFrame !== 'none' ? `avatar-frame--${equippedFrame}` : '');

  listEl.innerHTML = `
    <div class="rating-skeleton" aria-label="Загружаем рейтинг">
      ${Array.from({ length: 6 }, () => '<div class="rating-skeleton__row"></div>').join('')}
    </div>`;

  let entries;
  try {
    entries = await fetchLeaderboard();
  } catch (e) {
    listEl.innerHTML = '<p class="topic-desc">Не удалось загрузить рейтинг.</p>';
    return;
  }

  if (!entries.length) {
    listEl.innerHTML = '<p class="topic-desc">Рейтинг пока пуст — пройди тесты и карточки, чтобы стать первым.</p>';
    return;
  }

  const myEntry = entries.find(e => e.isCurrentUser);

  /* ---------- Моё место ---------- */
  if (myEntry) {
    const ahead = entries[myEntry.place - 2];
    const ranks = LexPrepProgress.RANKS;
    const rankIndex = ranks.findIndex(r => r.key === myEntry.rank);
    const nextRank = rankIndex >= 0 ? ranks[rankIndex + 1] : null;
    const nextRankXp = nextRank && typeof LexPrepProgress.xpThreshold === 'function'
      ? LexPrepProgress.xpThreshold(nextRank.minLevel)
      : null;
    const currentRankXp = rankIndex >= 0 && typeof LexPrepProgress.xpThreshold === 'function'
      ? LexPrepProgress.xpThreshold(ranks[rankIndex].minLevel)
      : 0;
    const leaguePercent = nextRankXp
      ? Math.max(3, Math.min(100, Math.round(((myEntry.xp - currentRankXp) / (nextRankXp - currentRankXp)) * 100)))
      : 100;

    meEl.innerHTML = `
      <div class="rating-me__top">
        <div class="rating-me__place">
          <span class="rating-me__place-label">Твоё место</span>
          <strong class="rating-me__place-num">#<span id="ratingMePlace">${myEntry.place}</span></strong>
        </div>
        ${ratingAvatar(myEntry, 'rating-me__avatar', frameFor(myEntry))}
        <div class="rating-me__info">
          <div class="rating-me__name">${escapeHtml(myEntry.name)}</div>
          <div class="rating-me__league">
            <img src="assets/badges/${myEntry.rankIcon}" alt="" />
            ${escapeHtml(myEntry.rankName)} · Ур. ${myEntry.level}
          </div>
        </div>
        <div class="rating-me__xp"><strong id="ratingMeXp">${formatXp(myEntry.xp)}</strong><span>XP</span></div>
      </div>
      <div class="rating-me__goals">
        <div class="rating-me__goal">
          <span class="rating-me__goal-icon" aria-hidden="true">${ahead ? '🎯' : '👑'}</span>
          <span>${ahead
            ? `До <strong>#${ahead.place}</strong> — ещё <strong>${formatXp(ahead.xp - myEntry.xp + 1)} XP</strong>`
            : 'Ты на первом месте — держи планку!'}</span>
        </div>
        <div class="rating-me__goal rating-me__goal--league">
          <span class="rating-me__goal-row">
            <span>${nextRank
              ? `До лиги «${escapeHtml(nextRank.name)}» — <strong>${formatXp(Math.max(0, nextRankXp - myEntry.xp))} XP</strong>`
              : 'Высшая лига — «Мастер LexPrep»'}</span>
            ${nextRank ? `<img src="assets/badges/${nextRank.icon}" alt="" />` : ''}
          </span>
          <span class="rating-me__bar"><span style="--w: ${leaguePercent}%"></span></span>
        </div>
      </div>
      <button class="btn btn--outline rating-me__find" type="button" id="ratingFindMe">Показать меня в списке</button>
    `;
    meEl.hidden = false;
    if (motion) {
      const placeEl = document.getElementById('ratingMePlace');
      placeEl.textContent = entries.length;
      setTimeout(() => motion.countTo(placeEl, myEntry.place, 900), 250);
    }
  }

  /* ---------- Пьедестал ---------- */
  const top = entries.slice(0, 3);
  if (top.length >= 2) {
    const order = [top[1], top[0], top[2]].filter(Boolean);
    podiumEl.innerHTML = order.map(entry => `
      <div class="podium podium--${entry.place} ${entry.isCurrentUser ? 'is-you' : ''}">
        <div class="podium__person">
          ${entry.place === 1 ? '<span class="podium__crown" aria-hidden="true">👑</span>' : ''}
          ${ratingAvatar(entry, 'podium__avatar', frameFor(entry))}
          <span class="podium__name">${escapeHtml(entry.name)}</span>
          <span class="podium__xp">${formatXp(entry.xp)} XP</span>
        </div>
        <div class="podium__stand">
          <img class="podium__badge" src="assets/badges/${entry.rankIcon}" alt="${escapeHtml(entry.rankName)}" />
          <span class="podium__place">${entry.place}</span>
        </div>
      </div>
    `).join('');
    podiumEl.hidden = false;
  }

  /* ---------- Фильтр по лигам ---------- */
  const counts = {};
  entries.forEach(e => { counts[e.rank] = (counts[e.rank] || 0) + 1; });
  legendEl.innerHTML = `
    <button type="button" class="rating-legend__item is-active" data-league="all">
      Все <span class="rating-legend__count">${entries.length}</span>
    </button>
    ${LexPrepProgress.RANKS.map(rank => `
      <button type="button" class="rating-legend__item" data-league="${rank.key}" ${counts[rank.key] ? '' : 'disabled'}>
        <img src="assets/badges/${rank.icon}" alt="" class="rating-legend__icon" />
        ${escapeHtml(rank.name)}
        <span class="rating-legend__count">${counts[rank.key] || 0}</span>
      </button>
    `).join('')}
  `;

  /* ---------- Список ---------- */
  function rowHtml(entry) {
    const medal = entry.place <= 3 ? ['🥇', '🥈', '🥉'][entry.place - 1] : `#${entry.place}`;
    return `
      <div class="rating-row ${entry.isCurrentUser ? 'is-you' : ''}" data-place="${entry.place}">
        <span class="rating-row__place">${medal}</span>
        ${ratingAvatar(entry, 'rating-row__avatar', frameFor(entry))}
        <div class="rating-row__info">
          <div class="rating-row__name">${escapeHtml(entry.name)}${entry.isCurrentUser ? ' <span class="rating-row__you-tag">это ты</span>' : ''}</div>
          <div class="rating-row__meta">
            <img src="assets/badges/${entry.rankIcon}" alt="" class="rating-row__badge" />
            <span>${escapeHtml(entry.rankName)}</span>
            <span class="rating-row__dot">·</span>
            <span>Ур. ${entry.level}</span>
          </div>
        </div>
        <div class="rating-row__xp">${formatXp(entry.xp)}<small>XP</small></div>
      </div>
    `;
  }

  function renderList(league) {
    // На пьедестале уже видны первые трое — в общем списке начинаем с #4.
    const podiumShown = !podiumEl.hidden;
    const visible = league === 'all'
      ? entries.filter(e => !podiumShown || e.place > 3)
      : entries.filter(e => e.rank === league);
    listEl.innerHTML = visible.length
      ? visible.map(rowHtml).join('')
      : '<p class="topic-desc">В этой лиге пока никого нет.</p>';
    if (motion) motion.stagger(listEl, '.rating-row', league === 'all' ? 350 : 0);
  }

  legendEl.querySelectorAll('[data-league]').forEach(btn => {
    btn.addEventListener('click', () => {
      legendEl.querySelectorAll('[data-league]').forEach(b => b.classList.toggle('is-active', b === btn));
      renderList(btn.dataset.league);
    });
  });

  renderList('all');

  const findBtn = document.getElementById('ratingFindMe');
  if (findBtn && myEntry) {
    findBtn.addEventListener('click', () => {
      let row = listEl.querySelector('.rating-row.is-you') || podiumEl.querySelector('.podium.is-you');
      if (!row) {
        legendEl.querySelector('[data-league="all"]').click();
        row = listEl.querySelector('.rating-row.is-you') || podiumEl.querySelector('.podium.is-you');
      }
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('is-flash');
      void row.offsetWidth;
      row.classList.add('is-flash');
    });
  }

  if (myEntry && typeof window.LexPrepNotifyRatingTop === 'function') {
    window.LexPrepNotifyRatingTop(myEntry.place, user);
  }
});
