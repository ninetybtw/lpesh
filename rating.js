/* ==========================================================================
RATING.JS — рендер страницы рейтинга. Логика данных живёт в leaderboard.js.
========================================================================== */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }

  if (typeof LexPrepProgress === 'undefined' || typeof fetchLeaderboard === 'undefined') return;

  const legendEl = document.getElementById('ratingLegend');
  const listEl = document.getElementById('ratingList');

  legendEl.innerHTML = LexPrepProgress.RANKS.map(rank => `
    <div class="rating-legend__item">
      <img src="assets/badges/${rank.icon}" alt="${escapeHtml(rank.name)}" class="rating-legend__icon" />
      <span>${escapeHtml(rank.name)}</span>
    </div>
  `).join('');

  const equippedFrame = localStorage.getItem('lexprep_shop_equipped');

  const entries = fetchLeaderboard();

  listEl.innerHTML = entries.map(entry => {
    const initial = (entry.name || 'U').trim().charAt(0).toUpperCase();
    const avatarStyle = entry.avatar ? `style="background-image:url(${entry.avatar});background-size:cover;background-position:center;"` : '';
    const frameClass = entry.isCurrentUser && equippedFrame && equippedFrame !== 'none' ? `avatar-frame--${equippedFrame}` : '';

    return `
      <div class="rating-row ${entry.isCurrentUser ? 'is-you' : ''}">
        <span class="rating-row__place">#${entry.place}</span>
        <span class="rating-row__avatar ${frameClass}" ${avatarStyle}>${entry.avatar ? '' : escapeHtml(initial)}</span>
        <div class="rating-row__info">
          <div class="rating-row__name">${escapeHtml(entry.name)}${entry.isCurrentUser ? ' <span class="rating-row__you-tag">это ты</span>' : ''}</div>
          <div class="rating-row__university">${escapeHtml(entry.university || 'Вуз не указан')}</div>
        </div>
        <div class="rating-row__league">
          <img src="assets/badges/${entry.rankIcon}" alt="${escapeHtml(entry.rankName)}" class="rating-row__badge" />
          <span class="rating-row__league-name">${escapeHtml(entry.rankName)}</span>
        </div>
        <div class="rating-row__level">Ур. ${entry.level}</div>
        <div class="rating-row__xp">${entry.xp} XP</div>
      </div>
    `;
  }).join('');
});
