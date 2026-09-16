/* ==========================================================================
NOTIFICATIONS.JS — колокольчик уведомлений в шапке. Подключается на всех
страницах, где есть #profileMenu (см. supabase/notifications.sql) — сам
вставляет кнопку с бейджем непрочитанных и выпадающий список рядом с
профилем, ничего в разметке страниц менять не нужно.

Тут же живут точки, которые САМИ создают уведомления себе (self-insert,
RLS разрешает только user_id = auth.uid()):
  - новый уровень (слушает событие 'lexprep:levelup' из progress.js);
  - топ-3 в общем рейтинге (проверяется здесь же на страницах, где есть
    рейтинг — см. вызов checkRatingTopNotification из rating.js);
  - истекающая подписка (проверка при каждой загрузке страницы, не чаще
    раза в сутки на пользователя — см. checkExpiringSubscription).
Уведомление о покупке подписки создаётся из shop.js напрямую в момент
покупки — здесь эта точка не нужна.
========================================================================== */

(function () {
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'только что';
    if (min < 60) return `${min} мин назад`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} ч назад`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} дн назад`;
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  const TYPE_ICONS = {
    levelup: '⭐',
    xp: '✨',
    subscription: '💳',
    subscription_expiring: '⏰',
    rating_top: '🏆',
    announcement: '📣',
    promo: '🎁',
    info: '🔔'
  };

  function buildWidget() {
    const profileMenu = document.getElementById('profileMenu');
    if (!profileMenu || document.getElementById('notifBell')) return null;

    const wrap = document.createElement('div');
    wrap.className = 'notif-widget';
    wrap.id = 'notifWidget';
    wrap.innerHTML = `
      <button class="notif-bell" type="button" id="notifBell" aria-label="Уведомления">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span class="notif-bell__badge" id="notifBadge" hidden>0</span>
      </button>
      <div class="notif-dropdown" id="notifDropdown" hidden>
        <div class="notif-dropdown__head">
          <span>Уведомления</span>
        </div>
        <div class="notif-dropdown__list" id="notifList">
          <p class="notif-empty">Загрузка…</p>
        </div>
      </div>
    `;
    profileMenu.parentNode.insertBefore(wrap, profileMenu);
    return wrap;
  }

  async function init() {
    const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
    if (!user || typeof LexPrepApi === 'undefined') return;

    const widget = buildWidget();
    if (!widget) return;

    const bell = document.getElementById('notifBell');
    const badge = document.getElementById('notifBadge');
    const dropdown = document.getElementById('notifDropdown');
    const listEl = document.getElementById('notifList');
    let cache = [];

    function renderBadge(count) {
      if (count > 0) {
        badge.hidden = false;
        badge.textContent = count > 9 ? '9+' : String(count);
      } else {
        badge.hidden = true;
      }
    }

    function renderList() {
      if (!cache.length) {
        listEl.innerHTML = '<p class="notif-empty">Пока ничего нет.</p>';
        return;
      }
      listEl.innerHTML = cache.map(n => `
        <a class="notif-item ${n.isRead ? '' : 'is-unread'}" href="${n.link ? escapeHtml(n.link) : '#'}" data-id="${n.id}">
          <span class="notif-item__icon">${TYPE_ICONS[n.type] || TYPE_ICONS.info}</span>
          <span class="notif-item__body">
            <span class="notif-item__title">${escapeHtml(n.title)}</span>
            ${n.body ? `<span class="notif-item__text">${escapeHtml(n.body)}</span>` : ''}
            <span class="notif-item__time">${timeAgo(n.createdAt)}</span>
          </span>
        </a>
      `).join('');
    }

    async function refresh() {
      try {
        const [count, list] = await Promise.all([
          LexPrepApi.getUnreadNotificationCount(),
          LexPrepApi.listNotifications(20)
        ]);
        renderBadge(count);
        cache = list;
        if (!dropdown.hidden) renderList();
      } catch (e) { /* тихо — колокольчик не критичен для остальной страницы */ }
    }

    async function openDropdown() {
      dropdown.hidden = false;
      renderList();
      const unreadIds = cache.filter(n => !n.isRead).map(n => n.id);
      if (unreadIds.length) {
        try {
          await LexPrepApi.markNotificationsRead(unreadIds);
          cache = cache.map(n => ({ ...n, isRead: true }));
          renderBadge(0);
          renderList();
        } catch (e) { /* не критично */ }
      }
    }

    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.hidden) openDropdown();
      else dropdown.hidden = true;
    });

    document.addEventListener('click', (e) => {
      if (!widget.contains(e.target)) dropdown.hidden = true;
    });

    refresh();
    setInterval(refresh, 60000);

    // Новый уровень/звание — событие кидает progress.js.
    window.addEventListener('lexprep:levelup', (e) => {
      const detail = e.detail || {};
      LexPrepApi.createSelfNotification({
        type: 'levelup',
        title: detail.rankChanged ? `Новое звание: ${detail.rankName}!` : `Новый уровень: ${detail.level}!`,
        body: detail.rankChanged ? `Ты дорос до звания «${detail.rankName}».` : 'Продолжай в том же духе.',
        link: 'profile.html#stats'
      }).then(refresh).catch(() => {});
    });

    checkExpiringSubscription(user);
  }

  // Не чаще раза в сутки на пользователя — иначе каждый заход на сайт с
  // истекающей подпиской заново создавал бы уведомление.
  function checkExpiringSubscription(user) {
    if (!user.planTier || user.planTier === 'basic' || !user.planExpiresAt) return;
    const expiresAt = new Date(user.planExpiresAt).getTime();
    const daysLeft = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysLeft < 0 || daysLeft > 3) return;

    const key = `lexprep_notif_expiring_${user.id}_${new Date().toDateString()}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');

    LexPrepApi.createSelfNotification({
      type: 'subscription_expiring',
      title: daysLeft === 0 ? 'Подписка истекает сегодня' : `Подписка истекает через ${daysLeft} ${daysLeft === 1 ? 'день' : 'дня'}`,
      body: 'Продли подписку, чтобы не потерять доступ к тарифу.',
      link: 'profile.html#subscription'
    }).catch(() => {});
  }

  // Топ-3 общего рейтинга — вызывается из rating.js после отрисовки
  // списка, не чаще раза в сутки на пользователя.
  window.LexPrepNotifyRatingTop = function (place, user) {
    if (!user || place > 3) return;
    const key = `lexprep_notif_rating_top_${user.id}_${new Date().toDateString()}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    if (typeof LexPrepApi === 'undefined' || !LexPrepApi.createSelfNotification) return;
    LexPrepApi.createSelfNotification({
      type: 'rating_top',
      title: `Ты в топ-3 рейтинга! (#${place})`,
      body: 'Так держать — другие уже наступают на пятки.',
      link: 'rating.html'
    }).catch(() => {});
  };

  document.addEventListener('DOMContentLoaded', init);
})();
