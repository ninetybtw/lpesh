/* ==========================================================================
MODERATOR.JS — панель модератора: очередь тестов/статей на публикацию,
ограниченное управление пользователями (бан, имя, аватар, монеты — не
больше 250 за раз, без тарифов и удаления), поддержка и предложения.
Доступ проверяется по profiles.is_moderator ИЛИ is_admin (админ видит и
может всё то же, что модератор, плюс отдельную admin.html).
========================================================================== */

const MOD_TICKET_STATUS_LABEL = { open: 'Открыт', answered: 'Отвечено', closed: 'Закрыт' };
const MOD_SUGGESTION_STATUS_LABEL = { new: 'Новое', reviewing: 'На рассмотрении', accepted: 'Принято', rejected: 'Отклонено' };
const MOD_COIN_GRANT_LIMIT = 250;

document.addEventListener('DOMContentLoaded', async () => {
  await (window.LexPrepContentReady || Promise.resolve());
  const guardEl = document.getElementById('modGuard');
  const contentEl = document.getElementById('modContent');

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

  if (!me.isModerator && !me.isAdmin) {
    guardEl.hidden = false;
    return;
  }

  contentEl.hidden = false;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------- Табы ---------------- */

  document.querySelectorAll('[data-mod-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.modTab;
      document.querySelectorAll('[data-mod-tab]').forEach(t => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('[data-mod-panel]').forEach(p => { p.hidden = p.dataset.modPanel !== target; });
      if (target === 'articles' && !articlesLoaded) loadArticles();
      if (target === 'users' && !usersLoaded) loadUsers();
      if (target === 'support' && !ticketsLoaded) loadTickets();
      if (target === 'suggestions' && !suggestionsLoaded) loadSuggestions();
    });
  });

  const DATA = typeof LEXPREP_DATA !== 'undefined' ? LEXPREP_DATA : [];
  function disciplineTitle(id) {
    const d = DATA.find(x => x.id === id);
    return d ? d.title : id;
  }
  function topicTitle(disciplineId, topicId) {
    const d = DATA.find(x => x.id === disciplineId);
    const t = d && d.topics.find(x => x.id === topicId);
    return t ? t.title : topicId;
  }

  /* ---------------- Тесты на модерации ---------------- */

  const testsList = document.getElementById('modTestsList');
  const testsRefreshBtn = document.getElementById('modTestsRefreshBtn');
  const testsPendingCountEl = document.getElementById('modTestsPendingCount');

  function renderTests(tests) {
    testsPendingCountEl.textContent = tests.length ? `(${tests.length})` : '';

    if (!tests.length) {
      testsList.innerHTML = '<p class="community-empty">Тестов на модерации нет.</p>';
      return;
    }
    testsList.innerHTML = tests.map(t => `
      <div class="community-item" data-test-id="${t.id}">
        <div class="community-item__head">
          <h3>${escapeHtml(t.title)}</h3>
          <span class="community-badge community-badge--open">${t.questions.length} вопросов</span>
        </div>
        <p class="community-item__message">
          ${escapeHtml(disciplineTitle(t.disciplineId))} → ${escapeHtml(topicTitle(t.disciplineId, t.topicId))}<br>
          Автор: ${escapeHtml(t.authorName || 'неизвестно')}${t.authorEmail ? ` (${escapeHtml(t.authorEmail)})` : ''}
        </p>
        <div class="community-item__meta"><span>${formatDateTime(t.createdAt)}</span></div>
        <div class="admin-item-actions">
          <button type="button" class="admin-action-btn" data-test-action="preview">Посмотреть вопросы</button>
          <button type="button" class="admin-action-btn" data-test-action="publish">Опубликовать</button>
          <button type="button" class="admin-action-btn admin-action-btn--warn" data-test-action="reject">Отклонить</button>
          <button type="button" class="admin-action-btn admin-action-btn--danger" data-test-action="delete">Удалить</button>
        </div>
      </div>
    `).join('');
  }

  let testsLoaded = false;
  async function loadTests() {
    testsList.innerHTML = '<p class="community-empty">Загрузка…</p>';
    try {
      const tests = await LexPrepApi.moderatorListPendingTests();
      testsLoaded = true;
      renderTests(tests);
      window.__modPendingTests = tests;
    } catch (err) {
      testsList.innerHTML = `<p class="community-empty">Не удалось загрузить: ${escapeHtml(err.message)}</p>`;
    }
  }

  testsRefreshBtn.addEventListener('click', loadTests);

  testsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-test-action]');
    if (!btn) return;
    const item = btn.closest('[data-test-id]');
    const id = item.dataset.testId;
    const test = (window.__modPendingTests || []).find(t => String(t.id) === id);
    try {
      if (btn.dataset.testAction === 'preview') {
        if (!test) return;
        const preview = test.questions.map((q, i) => `${i + 1}. ${q.question}\n${q.options.map((o, oi) => `${test_correct(q, oi) ? '✓' : ' '} ${o}`).join('\n')}`).join('\n\n');
        alert(preview);
      } else if (btn.dataset.testAction === 'publish') {
        if (!confirm('Опубликовать этот тест? Он станет виден всем в теме.')) return;
        await LexPrepApi.moderatorSetTestStatus(id, 'published');
        await loadTests();
      } else if (btn.dataset.testAction === 'reject') {
        const comment = prompt('Причина отклонения (увидит автор):', '');
        if (comment === null) return;
        await LexPrepApi.moderatorSetTestStatus(id, 'rejected', comment.trim());
        await loadTests();
      } else if (btn.dataset.testAction === 'delete') {
        if (!confirm('Удалить этот тест безвозвратно?')) return;
        await LexPrepApi.deleteUserTest(id);
        await loadTests();
      }
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  });

  function test_correct(q, optionIndex) {
    const correct = Array.isArray(q.correct) ? q.correct : [q.correct];
    return correct.includes(optionIndex);
  }

  /* ---------------- Статьи на модерации ---------------- */

  const articlesList = document.getElementById('modArticlesList');
  const articlesRefreshBtn = document.getElementById('modArticlesRefreshBtn');
  const articlesPendingCountEl = document.getElementById('modArticlesPendingCount');
  let articlesLoaded = false;

  function renderArticlesQueue(articles) {
    articlesPendingCountEl.textContent = articles.length ? `(${articles.length})` : '';

    if (!articles.length) {
      articlesList.innerHTML = '<p class="community-empty">Статей на модерации нет.</p>';
      return;
    }
    articlesList.innerHTML = articles.map(a => `
      <div class="community-item" data-article-id="${a.id}">
        <div class="community-item__head">
          <h3>${escapeHtml(a.title)}</h3>
          <span class="community-badge community-badge--open">${escapeHtml(a.topic)}</span>
        </div>
        <p class="community-item__message">
          ${escapeHtml(a.excerpt)}<br>
          Автор: ${escapeHtml(a.authorName || 'неизвестно')}${a.authorEmail ? ` (${escapeHtml(a.authorEmail)})` : ''}
        </p>
        <div class="community-item__meta"><span>${formatDateTime(a.createdAt)} · ~${a.readTime} мин чтения</span></div>
        <div class="admin-item-actions">
          <button type="button" class="admin-action-btn" data-article-action="preview">Читать текст</button>
          <button type="button" class="admin-action-btn" data-article-action="publish">Опубликовать</button>
          <button type="button" class="admin-action-btn admin-action-btn--warn" data-article-action="reject">Отклонить</button>
          <button type="button" class="admin-action-btn admin-action-btn--danger" data-article-action="delete">Удалить</button>
        </div>
      </div>
    `).join('');
  }

  async function loadArticles() {
    articlesList.innerHTML = '<p class="community-empty">Загрузка…</p>';
    try {
      const articles = await LexPrepApi.moderatorListPendingArticles();
      articlesLoaded = true;
      renderArticlesQueue(articles);
      window.__modPendingArticles = articles;
    } catch (err) {
      articlesList.innerHTML = `<p class="community-empty">Не удалось загрузить: ${escapeHtml(err.message)}</p>`;
    }
  }

  articlesRefreshBtn.addEventListener('click', loadArticles);

  articlesList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-article-action]');
    if (!btn) return;
    const item = btn.closest('[data-article-id]');
    const id = item.dataset.articleId;
    const article = (window.__modPendingArticles || []).find(a => String(a.id) === id);
    try {
      if (btn.dataset.articleAction === 'preview') {
        if (!article) return;
        const container = document.createElement('div');
        container.innerHTML = article.body;
        alert(container.textContent.trim());
      } else if (btn.dataset.articleAction === 'publish') {
        if (!confirm('Опубликовать эту статью? Она станет видна всем в каталоге.')) return;
        await LexPrepApi.moderatorSetArticleStatus(id, 'published');
        await loadArticles();
      } else if (btn.dataset.articleAction === 'reject') {
        const comment = prompt('Причина отклонения (увидит автор):', '');
        if (comment === null) return;
        await LexPrepApi.moderatorSetArticleStatus(id, 'rejected', comment.trim());
        await loadArticles();
      } else if (btn.dataset.articleAction === 'delete') {
        if (!confirm('Удалить эту статью безвозвратно?')) return;
        await LexPrepApi.deleteUserArticle(id);
        await loadArticles();
      }
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  });

  /* ---------------- Пользователи (ограниченно) ---------------- */

  const usersBody = document.getElementById('modUsersBody');
  const usersSearchEl = document.getElementById('modUserSearch');
  const usersCountEl = document.getElementById('modUserCount');
  const usersRefreshBtn = document.getElementById('modUsersRefreshBtn');
  let usersLoaded = false;
  let users = [];

  function renderUsersTable(filter) {
    const query = (filter || '').trim().toLowerCase();
    const filtered = !query
      ? users
      : users.filter(u => (u.name || '').toLowerCase().includes(query) || (u.email || '').toLowerCase().includes(query));

    usersCountEl.textContent = `${filtered.length} из ${users.length}`;

    if (!filtered.length) {
      usersBody.innerHTML = `<tr><td colspan="5" class="admin-empty">Никого не нашлось.</td></tr>`;
      return;
    }

    usersBody.innerHTML = filtered.map(u => {
      const avatarHtml = u.avatar
        ? `<span class="admin-avatar" style="background-image:url(${escapeHtml(u.avatar)})"></span>`
        : `<span class="admin-avatar">${escapeHtml((u.name || 'U').trim().charAt(0).toUpperCase())}</span>`;

      return `
        <tr data-user-row="${u.id}">
          <td>
            <div class="admin-user-cell">
              ${avatarHtml}
              <div>
                <div class="admin-user-cell__name">${escapeHtml(u.name)}${u.isAdmin ? ' <span class="admin-badge admin-badge--admin">админ</span>' : ''}${u.isModerator ? ' <span class="admin-badge admin-badge--admin">модератор</span>' : ''}</div>
                <div class="admin-user-cell__email">${escapeHtml(u.email)}</div>
              </div>
            </div>
          </td>
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
              <button type="button" class="admin-action-btn" data-action="grant-coins" title="Начислить монеты (не больше ${MOD_COIN_GRANT_LIMIT} за раз)">+Монеты</button>
              <button type="button" class="admin-action-btn ${u.isBanned ? '' : 'admin-action-btn--warn'}" data-action="toggle-ban" ${(u.id === me.id || u.isAdmin) ? 'disabled' : ''}>${u.isBanned ? 'Разбанить' : 'Забанить'}</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function loadUsers() {
    usersBody.innerHTML = `<tr><td colspan="5" class="admin-empty">Загрузка…</td></tr>`;
    try {
      users = await LexPrepApi.adminListUsers();
      usersLoaded = true;
      renderUsersTable(usersSearchEl.value);
    } catch (err) {
      usersBody.innerHTML = `<tr><td colspan="5" class="admin-empty">Не удалось загрузить список: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  usersSearchEl.addEventListener('input', () => renderUsersTable(usersSearchEl.value));
  usersRefreshBtn.addEventListener('click', loadUsers);

  usersBody.addEventListener('click', async (e) => {
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
        const amountStr = prompt(`Сколько монет начислить сверху текущих ${user.bonusCoins}? Максимум ${MOD_COIN_GRANT_LIMIT} за раз (можно отрицательное число).`, '100');
        if (amountStr === null) return;
        const amount = Number(amountStr);
        if (!Number.isFinite(amount) || amount === 0) return;
        if (amount > MOD_COIN_GRANT_LIMIT) {
          alert(`Модератор может начислить не больше ${MOD_COIN_GRANT_LIMIT} монет за раз.`);
          return;
        }
        await LexPrepApi.moderatorGrantCoins(userId, amount, user.bonusCoins);
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
      }
      await loadUsers();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  });

  /* ---------------- Поддержка ---------------- */

  const ticketsList = document.getElementById('modTicketsList');
  const ticketsRefreshBtn = document.getElementById('modTicketsRefreshBtn');
  const ticketsOpenCountEl = document.getElementById('modTicketsOpenCount');
  let ticketsLoaded = false;

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
          <span class="community-badge community-badge--${t.status}">${MOD_TICKET_STATUS_LABEL[t.status] || t.status}</span>
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

  const suggestionsList = document.getElementById('modSuggestionsList');
  const suggestionsRefreshBtn = document.getElementById('modSuggestionsRefreshBtn');
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
          <span class="community-badge community-badge--${s.status}">${MOD_SUGGESTION_STATUS_LABEL[s.status] || s.status}</span>
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

  await loadTests();
});
