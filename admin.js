/* ==========================================================================
ADMIN.JS — панель администратора: список аккаунтов из Supabase (profiles),
реальные бан/удаление/правки имени и аватара, выдача бонусных монет и
подписки. Доступ проверяется дважды: здесь по profiles.is_admin (RLS сам
не даст обычному пользователю прочитать чужие строки) и ещё раз на
сервере в Edge Function для удаления аккаунта.
========================================================================== */

const PLAN_TITLES = { basic: 'Базовая', pro: 'Про', max: 'Максимум' };
const ADMIN_TICKET_STATUS_LABEL = { open: 'Открыт', answered: 'Отвечено', closed: 'Закрыт' };
const ADMIN_SUGGESTION_STATUS_LABEL = { new: 'Новое', reviewing: 'На рассмотрении', accepted: 'Принято', rejected: 'Отклонено' };

document.addEventListener('DOMContentLoaded', async () => {
  const guardEl = document.getElementById('adminGuard');
  const contentEl = document.getElementById('adminContent');
  const bodyEl = document.getElementById('adminUsersBody');
  const searchEl = document.getElementById('adminSearch');
  const countEl = document.getElementById('adminCount');
  const refreshBtn = document.getElementById('adminRefreshBtn');

  if (typeof LexPrepApi === 'undefined') {
    guardEl.hidden = false;
    return;
  }

  let me;
  try {
    me = await LexPrepApi.me();
  } catch (e) {
    window.location.href = 'auth.html';
    return;
  }

  if (!me.isAdmin) {
    guardEl.hidden = false;
    return;
  }

  contentEl.hidden = false;

  let users = [];

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function renderTable(filter) {
    const query = (filter || '').trim().toLowerCase();
    const filtered = !query
      ? users
      : users.filter(u => (u.name || '').toLowerCase().includes(query) || (u.email || '').toLowerCase().includes(query));

    countEl.textContent = `${filtered.length} из ${users.length}`;

    if (!filtered.length) {
      bodyEl.innerHTML = `<tr><td colspan="6" class="admin-empty">Никого не нашлось.</td></tr>`;
      return;
    }

    bodyEl.innerHTML = filtered.map(u => {
      const planActive = u.planTier !== 'basic' && u.planExpiresAt && new Date(u.planExpiresAt).getTime() > Date.now();
      const planLabel = planActive
        ? `${PLAN_TITLES[u.planTier] || u.planTier} до ${formatDate(u.planExpiresAt)}`
        : 'Базовая';

      const avatarHtml = u.avatar
        ? `<span class="admin-avatar" style="background-image:url(${escapeHtml(u.avatar)})"></span>`
        : `<span class="admin-avatar">${escapeHtml((u.name || 'U').trim().charAt(0).toUpperCase())}</span>`;

      return `
        <tr data-user-row="${u.id}">
          <td>
            <div class="admin-user-cell">
              ${avatarHtml}
              <div>
                <div class="admin-user-cell__name">${escapeHtml(u.name)}${u.isAdmin ? ' <span class="admin-badge admin-badge--admin">админ</span>' : ''}</div>
                <div class="admin-user-cell__email">${escapeHtml(u.email)}</div>
              </div>
            </div>
          </td>
          <td>${escapeHtml(planLabel)}</td>
          <td>${u.bonusCoins}</td>
          <td>
            ${u.isBanned
              ? `<span class="admin-badge admin-badge--banned" title="${escapeHtml(u.banReason || '')}">заблокирован</span>`
              : `<span class="admin-badge admin-badge--ok">активен</span>`}
          </td>
          <td>${formatDate(u.createdAt)}</td>
          <td>
            <div class="admin-actions">
              <button type="button" class="admin-action-btn" data-action="edit-name" title="Изменить имя">Имя</button>
              <button type="button" class="admin-action-btn" data-action="edit-avatar" title="Изменить аватар (URL)">Аватар</button>
              <button type="button" class="admin-action-btn" data-action="grant-coins" title="Начислить монеты">+Монеты</button>
              <button type="button" class="admin-action-btn" data-action="grant-plan" title="Выдать подписку">Тариф</button>
              <button type="button" class="admin-action-btn ${u.isBanned ? '' : 'admin-action-btn--warn'}" data-action="toggle-ban" ${u.id === me.id ? 'disabled' : ''}>${u.isBanned ? 'Разбанить' : 'Забанить'}</button>
              <button type="button" class="admin-action-btn admin-action-btn--danger" data-action="delete" ${u.id === me.id ? 'disabled' : ''}>Удалить</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function loadUsers() {
    bodyEl.innerHTML = `<tr><td colspan="6" class="admin-empty">Загрузка…</td></tr>`;
    try {
      users = await LexPrepApi.adminListUsers();
      renderTable(searchEl.value);
    } catch (err) {
      bodyEl.innerHTML = `<tr><td colspan="6" class="admin-empty">Не удалось загрузить список: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  searchEl.addEventListener('input', () => renderTable(searchEl.value));
  refreshBtn.addEventListener('click', loadUsers);

  bodyEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('[data-user-row]');
    const userId = row.dataset.userRow;
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const action = btn.dataset.action;

    try {
      if (action === 'edit-name') {
        const name = prompt('Новое имя:', user.name);
        if (name === null || !name.trim()) return;
        await LexPrepApi.adminUpdateUser(userId, { name: name.trim() });
      } else if (action === 'edit-avatar') {
        const url = prompt('Ссылка на аватар (пусто — убрать аватар):', user.avatar || '');
        if (url === null) return;
        await LexPrepApi.adminUpdateUser(userId, { avatar: url.trim() || null });
      } else if (action === 'grant-coins') {
        const amountStr = prompt(`Сколько монет начислить сверху текущих ${user.bonusCoins}? (можно отрицательное число)`, '100');
        if (amountStr === null) return;
        const amount = Number(amountStr);
        if (!Number.isFinite(amount) || amount === 0) return;
        await LexPrepApi.adminGrantCoins(userId, amount, user.bonusCoins);
      } else if (action === 'grant-plan') {
        const tier = prompt('Тариф: basic, pro или max', user.planTier === 'basic' ? 'pro' : user.planTier);
        if (tier === null) return;
        if (!['basic', 'pro', 'max'].includes(tier)) {
          alert('Тариф должен быть basic, pro или max.');
          return;
        }
        if (tier === 'basic') {
          await LexPrepApi.adminUpdateUser(userId, { planTier: 'basic', planExpiresAt: null });
        } else {
          const daysStr = prompt('На сколько дней?', '30');
          if (daysStr === null) return;
          const days = Number(daysStr);
          if (!Number.isFinite(days) || days <= 0) return;
          await LexPrepApi.adminGrantSubscription(userId, tier, days);
        }
      } else if (action === 'toggle-ban') {
        if (user.isBanned) {
          if (!confirm(`Разблокировать ${user.name}?`)) return;
          await LexPrepApi.adminSetBanned(userId, false);
        } else {
          const reason = prompt(`Причина блокировки ${user.name} (необязательно):`, '');
          if (reason === null) return;
          if (!confirm(`Заблокировать ${user.name}? Аккаунт будет выходить из сессии автоматически.`)) return;
          await LexPrepApi.adminSetBanned(userId, true, reason);
        }
      } else if (action === 'delete') {
        if (!confirm(`Удалить аккаунт ${user.name} (${user.email}) безвозвратно? Это действие нельзя отменить.`)) return;
        await LexPrepApi.adminDeleteUser(userId);
      }
      await loadUsers();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  });

  await loadUsers();

  /* ---------------- Табы ---------------- */

  document.querySelectorAll('[data-admin-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.adminTab;
      document.querySelectorAll('[data-admin-tab]').forEach(t => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('[data-admin-panel]').forEach(p => { p.hidden = p.dataset.adminPanel !== target; });
      if (target === 'support' && !ticketsLoaded) loadTickets();
      if (target === 'suggestions' && !suggestionsLoaded) loadSuggestions();
    });
  });

  /* ---------------- Поддержка ---------------- */

  const ticketsList = document.getElementById('adminTicketsList');
  const ticketsRefreshBtn = document.getElementById('adminTicketsRefreshBtn');
  const ticketsOpenCountEl = document.getElementById('adminTicketsOpenCount');
  let ticketsLoaded = false;

  function formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderTickets(tickets) {
    const openCount = tickets.filter(t => t.status === 'open').length;
    ticketsOpenCountEl.textContent = openCount ? `(${openCount})` : '';

    if (!tickets.length) {
      ticketsList.innerHTML = '<p class="community-empty">Обращений пока нет.</p>';
      return;
    }
    ticketsList.innerHTML = tickets.map(t => `
      <div class="community-item" data-ticket-id="${t.id}">
        <div class="community-item__head">
          <h3>${escapeHtml(t.subject)}</h3>
          <span class="community-badge community-badge--${t.status}">${ADMIN_TICKET_STATUS_LABEL[t.status] || t.status}</span>
        </div>
        <p class="community-item__message">${escapeHtml(t.message)}</p>
        <div class="community-item__meta"><span>${formatDateTime(t.createdAt)}</span></div>
        ${t.adminReply ? `
          <div class="community-item__reply">
            <div class="community-item__reply-label">Ответ поддержки</div>
            <p>${escapeHtml(t.adminReply)}</p>
          </div>` : ''}
        <div class="admin-item-actions">
          <button type="button" class="admin-action-btn" data-ticket-action="reply">${t.adminReply ? 'Изменить ответ' : 'Ответить'}</button>
          ${t.status !== 'closed' ? '<button type="button" class="admin-action-btn" data-ticket-action="close">Закрыть</button>' : ''}
        </div>
      </div>
    `).join('');
  }

  async function loadTickets() {
    ticketsList.innerHTML = '<p class="community-empty">Загрузка…</p>';
    try {
      const tickets = await LexPrepApi.adminListSupportTickets();
      ticketsLoaded = true;
      renderTickets(tickets);
    } catch (err) {
      ticketsList.innerHTML = `<p class="community-empty">Не удалось загрузить: ${escapeHtml(err.message)}</p>`;
    }
  }

  ticketsRefreshBtn.addEventListener('click', loadTickets);

  ticketsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ticket-action]');
    if (!btn) return;
    const item = btn.closest('[data-ticket-id]');
    const id = item.dataset.ticketId;
    try {
      if (btn.dataset.ticketAction === 'reply') {
        const reply = prompt('Ответ пользователю:', '');
        if (reply === null || !reply.trim()) return;
        await LexPrepApi.adminReplyTicket(id, reply.trim());
      } else if (btn.dataset.ticketAction === 'close') {
        await LexPrepApi.adminSetTicketStatus(id, 'closed');
      }
      await loadTickets();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  });

  /* ---------------- Предложения ---------------- */

  const suggestionsList = document.getElementById('adminSuggestionsList');
  const suggestionsRefreshBtn = document.getElementById('adminSuggestionsRefreshBtn');
  let suggestionsLoaded = false;

  function renderSuggestions(suggestions) {
    if (!suggestions.length) {
      suggestionsList.innerHTML = '<p class="community-empty">Предложений пока нет.</p>';
      return;
    }
    suggestionsList.innerHTML = suggestions.map(s => `
      <div class="community-item" data-suggestion-id="${s.id}">
        <div class="community-item__head">
          <h3>${escapeHtml(s.title)}</h3>
          <span class="community-badge community-badge--${s.status}">${ADMIN_SUGGESTION_STATUS_LABEL[s.status] || s.status}</span>
        </div>
        <p class="community-item__message">${escapeHtml(s.message)}</p>
        <div class="community-item__meta"><span>${formatDateTime(s.createdAt)} · ${s.votes} голосов</span></div>
        ${s.adminComment ? `
          <div class="community-item__reply">
            <div class="community-item__reply-label">Комментарий команды</div>
            <p>${escapeHtml(s.adminComment)}</p>
          </div>` : ''}
        <div class="admin-item-actions">
          <button type="button" class="admin-action-btn" data-suggestion-action="reviewing">На рассмотрение</button>
          <button type="button" class="admin-action-btn" data-suggestion-action="accepted">Принять</button>
          <button type="button" class="admin-action-btn admin-action-btn--warn" data-suggestion-action="rejected">Отклонить</button>
          <button type="button" class="admin-action-btn" data-suggestion-action="comment">Комментарий</button>
        </div>
      </div>
    `).join('');
  }

  async function loadSuggestions() {
    suggestionsList.innerHTML = '<p class="community-empty">Загрузка…</p>';
    try {
      const suggestions = await LexPrepApi.listSuggestions();
      suggestionsLoaded = true;
      renderSuggestions(suggestions);
    } catch (err) {
      suggestionsList.innerHTML = `<p class="community-empty">Не удалось загрузить: ${escapeHtml(err.message)}</p>`;
    }
  }

  suggestionsRefreshBtn.addEventListener('click', loadSuggestions);

  suggestionsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-suggestion-action]');
    if (!btn) return;
    const item = btn.closest('[data-suggestion-id]');
    const id = item.dataset.suggestionId;
    const action = btn.dataset.suggestionAction;
    try {
      if (action === 'comment') {
        const comment = prompt('Комментарий команды:', '');
        if (comment === null) return;
        await LexPrepApi.adminUpdateSuggestion(id, { adminComment: comment.trim() });
      } else {
        await LexPrepApi.adminUpdateSuggestion(id, { status: action });
      }
      await loadSuggestions();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  });
});
