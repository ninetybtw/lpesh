/* ==========================================================================
ADMIN.JS — панель администратора: список аккаунтов из Supabase (profiles),
реальные бан/удаление/правки имени и аватара, выдача бонусных монет и
подписки. Доступ проверяется дважды: здесь по profiles.is_admin (RLS сам
не даст обычному пользователю прочитать чужие строки) и ещё раз на
сервере в Edge Function для удаления аккаунта.
========================================================================== */

const PLAN_TITLES = { basic: 'Базовая', pro: 'Про', max: 'Максимум' };
const ADMIN_TICKET_STATUS_LABEL = { open: 'Открыт', answered: 'Отвечено', closed: 'Закрыт' };
const ADMIN_FEEDBACK_STATUS_LABEL = { new: 'Новое', read: 'Прочитано', closed: 'Закрыто' };
const ADMIN_SUGGESTION_STATUS_LABEL = { new: 'Новое', reviewing: 'На рассмотрении', accepted: 'Принято', rejected: 'Отклонено' };

document.addEventListener('DOMContentLoaded', async () => {
  await (window.LexPrepContentReady || Promise.resolve());
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
        ? `${PLAN_TITLES[u.planTier] || u.planTier} до ${formatDate(u.planExpiresAt)}${u.planBillingPeriod === 'annual' ? ' (год)' : ''}`
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
                <div class="admin-user-cell__name">${escapeHtml(u.name)}${u.isAdmin ? ' <span class="admin-badge admin-badge--admin">админ</span>' : ''}${u.isModerator ? ' <span class="admin-badge admin-badge--admin">модератор</span>' : ''}</div>
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
              <button type="button" class="admin-action-btn" data-action="toggle-moderator" ${u.id === me.id ? 'disabled' : ''}>${u.isModerator ? 'Снять модератора' : 'Сделать модератором'}</button>
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
        await LexPrepApi.logAdminAction('edit-name', { targetUserId: userId, targetLabel: user.email, details: `«${user.name}» → «${name.trim()}»` });
      } else if (action === 'edit-avatar') {
        const url = prompt('Ссылка на аватар (пусто — убрать аватар):', user.avatar || '');
        if (url === null) return;
        await LexPrepApi.adminUpdateUser(userId, { avatar: url.trim() || null });
        await LexPrepApi.logAdminAction('edit-avatar', { targetUserId: userId, targetLabel: user.email });
      } else if (action === 'grant-coins') {
        const amountStr = prompt(`Сколько монет начислить сверху уже начисленных вручную ${user.bonusCoins}? Это не полный баланс пользователя в магазине — тот дополнительно учитывает заработанные и потраченные монеты. (можно отрицательное число)`, '100');
        if (amountStr === null) return;
        const amount = Number(amountStr);
        if (!Number.isFinite(amount) || amount === 0) return;
        if (Math.abs(amount) >= 100000 && !confirm(`Подтверди: начислить ${amount} монет — похоже на опечатку в количестве нулей.`)) return;
        await LexPrepApi.adminGrantCoins(userId, amount, user.bonusCoins);
        await LexPrepApi.logAdminAction('grant-coins', { targetUserId: userId, targetLabel: user.email, details: `${amount > 0 ? '+' : ''}${amount} (было ${user.bonusCoins})` });
      } else if (action === 'grant-plan') {
        const tier = prompt('Тариф: basic, pro или max', user.planTier === 'basic' ? 'pro' : user.planTier);
        if (tier === null) return;
        if (!['basic', 'pro', 'max'].includes(tier)) {
          alert('Тариф должен быть basic, pro или max.');
          return;
        }
        if (tier === 'basic') {
          await LexPrepApi.adminUpdateUser(userId, { planTier: 'basic', planExpiresAt: null, planBillingPeriod: 'monthly' });
          await LexPrepApi.logAdminAction('grant-plan', { targetUserId: userId, targetLabel: user.email, details: 'basic (снята подписка)' });
        } else {
          const daysStr = prompt('На сколько дней?', '30');
          if (daysStr === null) return;
          const days = Number(daysStr);
          if (!Number.isFinite(days) || days <= 0) return;
          const periodStr = prompt('Период оплаты: monthly (помесячно) или annual (год, даёт продвинутого ИИ-консультанта)', 'monthly');
          if (periodStr === null) return;
          const billingPeriod = periodStr.trim().toLowerCase() === 'annual' ? 'annual' : 'monthly';
          await LexPrepApi.adminGrantSubscription(userId, tier, days, billingPeriod);
          await LexPrepApi.logAdminAction('grant-plan', { targetUserId: userId, targetLabel: user.email, details: `${tier} на ${days} дн. (${billingPeriod})` });
        }
      } else if (action === 'toggle-moderator') {
        if (!confirm(`${user.isModerator ? 'Снять права модератора у' : 'Сделать модератором'} ${user.name}?`)) return;
        await LexPrepApi.adminSetModerator(userId, !user.isModerator);
        await LexPrepApi.logAdminAction('toggle-moderator', { targetUserId: userId, targetLabel: user.email, details: user.isModerator ? 'сняты права модератора' : 'выданы права модератора' });
      } else if (action === 'toggle-ban') {
        if (user.isBanned) {
          if (!confirm(`Разблокировать ${user.name}?`)) return;
          await LexPrepApi.adminSetBanned(userId, false);
          await LexPrepApi.logAdminAction('unban', { targetUserId: userId, targetLabel: user.email });
        } else {
          const reason = prompt(`Причина блокировки ${user.name} (необязательно):`, '');
          if (reason === null) return;
          if (!confirm(`Заблокировать ${user.name}? Аккаунт будет выходить из сессии автоматически.`)) return;
          await LexPrepApi.adminSetBanned(userId, true, reason);
          await LexPrepApi.logAdminAction('ban', { targetUserId: userId, targetLabel: user.email, details: reason || 'без причины' });
        }
      } else if (action === 'delete') {
        if (!confirm(`Удалить аккаунт ${user.name} (${user.email}) безвозвратно? Это действие нельзя отменить.`)) return;
        await LexPrepApi.logAdminAction('delete-user', { targetUserId: userId, targetLabel: user.email });
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
      if (target === 'tests' && !testsLoaded) loadTests();
      if (target === 'articles' && !articlesLoaded) loadArticles();
      if (target === 'support' && !ticketsLoaded) loadTickets();
      if (target === 'feedback' && !feedbackLoaded) loadFeedback();
      if (target === 'suggestions' && !suggestionsLoaded) loadSuggestions();
      if (target === 'logs' && !logsLoaded) loadLogs();
    });
  });

  /* ---------------- Журнал действий админов/модераторов ---------------- */

  const ADMIN_LOG_ACTION_LABEL = {
    'edit-name': 'изменил(а) имя',
    'edit-avatar': 'изменил(а) аватар',
    'grant-coins': 'начислил(а) монеты',
    'grant-plan': 'выдал(а) тариф',
    'toggle-moderator': 'изменил(а) роль модератора',
    'ban': 'заблокировал(а)',
    'unban': 'разблокировал(а)',
    'delete-user': 'удалил(а) аккаунт',
    'publish-test': 'опубликовал(а) тест',
    'reject-test': 'отклонил(а) тест',
    'delete-test': 'удалил(а) тест',
    'publish-article': 'опубликовал(а) статью',
    'reject-article': 'отклонил(а) статью',
    'delete-article': 'удалил(а) статью',
    'reply-ticket': 'ответил(а) на тикет',
    'close-ticket': 'закрыл(а) тикет',
    'read-feedback': 'отметил(а) обращение прочитанным',
    'close-feedback': 'закрыл(а) обращение',
    'comment-suggestion': 'прокомментировал(а) предложение',
    'suggestion-status': 'сменил(а) статус предложения'
  };

  const logsBody = document.getElementById('adminLogsBody');
  const logsRefreshBtn = document.getElementById('adminLogsRefreshBtn');
  let logsLoaded = false;

  function renderLogs(logs) {
    if (!logs.length) {
      logsBody.innerHTML = '<tr><td colspan="5" class="admin-empty">Записей пока нет.</td></tr>';
      return;
    }
    logsBody.innerHTML = logs.map(l => `
      <tr>
        <td>${formatDateTime(l.createdAt)}</td>
        <td>${escapeHtml(l.actorName || '—')} <span class="admin-badge ${l.actorRole === 'admin' ? 'admin-badge--admin' : ''}">${l.actorRole === 'admin' ? 'админ' : 'модератор'}</span></td>
        <td>${escapeHtml(ADMIN_LOG_ACTION_LABEL[l.action] || l.action)}</td>
        <td>${escapeHtml(l.targetLabel || '—')}</td>
        <td>${escapeHtml(l.details || '—')}</td>
      </tr>
    `).join('');
  }

  async function loadLogs() {
    logsBody.innerHTML = '<tr><td colspan="5" class="admin-empty">Загрузка…</td></tr>';
    try {
      const logs = await LexPrepApi.adminListAuditLog();
      logsLoaded = true;
      renderLogs(logs);
    } catch (err) {
      logsBody.innerHTML = `<tr><td colspan="5" class="admin-empty">Не удалось загрузить: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  logsRefreshBtn.addEventListener('click', loadLogs);

  /* ---------------- Тесты и статьи на модерации ---------------- */

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
  function testCorrect(q, optionIndex) {
    const correct = Array.isArray(q.correct) ? q.correct : [q.correct];
    return correct.includes(optionIndex);
  }

  const testsList = document.getElementById('adminTestsList');
  const testsRefreshBtn = document.getElementById('adminTestsRefreshBtn');
  const testsPendingCountEl = document.getElementById('adminTestsPendingCount');
  let testsLoaded = false;
  let pendingTests = [];

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

  async function loadTests() {
    testsList.innerHTML = '<p class="community-empty">Загрузка…</p>';
    try {
      pendingTests = await LexPrepApi.moderatorListPendingTests();
      testsLoaded = true;
      renderTests(pendingTests);
    } catch (err) {
      testsList.innerHTML = `<p class="community-empty">Не удалось загрузить: ${escapeHtml(err.message)}</p>`;
    }
  }

  testsRefreshBtn.addEventListener('click', loadTests);

  testsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-test-action]');
    if (!btn) return;
    const id = btn.closest('[data-test-id]').dataset.testId;
    const test = pendingTests.find(t => String(t.id) === id);
    try {
      if (btn.dataset.testAction === 'preview') {
        if (!test) return;
        alert(test.questions.map((q, i) => `${i + 1}. ${q.question}\n${q.options.map((o, oi) => `${testCorrect(q, oi) ? '✓' : ' '} ${o}`).join('\n')}`).join('\n\n'));
      } else if (btn.dataset.testAction === 'publish') {
        if (!confirm('Опубликовать этот тест? Он станет виден всем в теме.')) return;
        await LexPrepApi.moderatorSetTestStatus(id, 'published');
        await LexPrepApi.logAdminAction('publish-test', { targetUserId: test && test.userId, targetLabel: test && test.title });
        await loadTests();
      } else if (btn.dataset.testAction === 'reject') {
        const comment = prompt('Причина отклонения (увидит автор):', '');
        if (comment === null) return;
        await LexPrepApi.moderatorSetTestStatus(id, 'rejected', comment.trim());
        await LexPrepApi.logAdminAction('reject-test', { targetUserId: test && test.userId, targetLabel: test && test.title, details: comment.trim() });
        await loadTests();
      } else if (btn.dataset.testAction === 'delete') {
        if (!confirm('Удалить этот тест безвозвратно?')) return;
        await LexPrepApi.deleteUserTest(id);
        await LexPrepApi.logAdminAction('delete-test', { targetUserId: test && test.userId, targetLabel: test && test.title });
        await loadTests();
      }
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  });

  const articlesList = document.getElementById('adminArticlesList');
  const articlesRefreshBtn = document.getElementById('adminArticlesRefreshBtn');
  const articlesPendingCountEl = document.getElementById('adminArticlesPendingCount');
  let articlesLoaded = false;
  let pendingArticles = [];

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
      pendingArticles = await LexPrepApi.moderatorListPendingArticles();
      articlesLoaded = true;
      renderArticlesQueue(pendingArticles);
    } catch (err) {
      articlesList.innerHTML = `<p class="community-empty">Не удалось загрузить: ${escapeHtml(err.message)}</p>`;
    }
  }

  articlesRefreshBtn.addEventListener('click', loadArticles);

  articlesList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-article-action]');
    if (!btn) return;
    const id = btn.closest('[data-article-id]').dataset.articleId;
    const article = pendingArticles.find(a => String(a.id) === id);
    try {
      if (btn.dataset.articleAction === 'preview') {
        if (!article) return;
        const container = document.createElement('div');
        container.innerHTML = article.body;
        alert(container.textContent.trim());
      } else if (btn.dataset.articleAction === 'publish') {
        if (!confirm('Опубликовать эту статью? Она станет видна всем в каталоге.')) return;
        await LexPrepApi.moderatorSetArticleStatus(id, 'published');
        await LexPrepApi.logAdminAction('publish-article', { targetUserId: article && article.userId, targetLabel: article && article.title });
        await loadArticles();
      } else if (btn.dataset.articleAction === 'reject') {
        const comment = prompt('Причина отклонения (увидит автор):', '');
        if (comment === null) return;
        await LexPrepApi.moderatorSetArticleStatus(id, 'rejected', comment.trim());
        await LexPrepApi.logAdminAction('reject-article', { targetUserId: article && article.userId, targetLabel: article && article.title, details: comment.trim() });
        await loadArticles();
      } else if (btn.dataset.articleAction === 'delete') {
        if (!confirm('Удалить эту статью безвозвратно?')) return;
        await LexPrepApi.deleteUserArticle(id);
        await LexPrepApi.logAdminAction('delete-article', { targetUserId: article && article.userId, targetLabel: article && article.title });
        await loadArticles();
      }
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
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

  let tickets = [];
  async function loadTickets() {
    ticketsList.innerHTML = '<p class="community-empty">Загрузка…</p>';
    try {
      tickets = await LexPrepApi.adminListSupportTickets();
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
    const ticket = tickets.find(t => String(t.id) === id);
    try {
      if (btn.dataset.ticketAction === 'reply') {
        const reply = prompt('Ответ пользователю:', '');
        if (reply === null || !reply.trim()) return;
        await LexPrepApi.adminReplyTicket(id, reply.trim());
        await LexPrepApi.logAdminAction('reply-ticket', { targetUserId: ticket && ticket.userId, targetLabel: ticket && ticket.subject, details: reply.trim() });
      } else if (btn.dataset.ticketAction === 'close') {
        await LexPrepApi.adminSetTicketStatus(id, 'closed');
        await LexPrepApi.logAdminAction('close-ticket', { targetUserId: ticket && ticket.userId, targetLabel: ticket && ticket.subject });
      }
      await loadTickets();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  });

  /* ---------------- Обратная связь с главной страницы ---------------- */

  const feedbackList = document.getElementById('adminFeedbackList');
  const feedbackRefreshBtn = document.getElementById('adminFeedbackRefreshBtn');
  const feedbackNewCountEl = document.getElementById('adminFeedbackNewCount');
  let feedbackLoaded = false;

  function renderFeedback(items) {
    const newCount = items.filter(f => f.status === 'new').length;
    feedbackNewCountEl.textContent = newCount ? `(${newCount})` : '';

    if (!items.length) {
      feedbackList.innerHTML = '<p class="community-empty">Обращений пока нет.</p>';
      return;
    }
    feedbackList.innerHTML = items.map(f => `
      <div class="community-item" data-feedback-id="${f.id}">
        <div class="community-item__head">
          <h3>${escapeHtml(f.name)}</h3>
          <span class="community-badge community-badge--${f.status}">${ADMIN_FEEDBACK_STATUS_LABEL[f.status] || f.status}</span>
        </div>
        <p class="community-item__message">${escapeHtml(f.message)}</p>
        <div class="community-item__meta"><span>${escapeHtml(f.email)}</span> · <span>${formatDateTime(f.createdAt)}</span></div>
        <div class="admin-item-actions">
          <a class="admin-action-btn" href="mailto:${encodeURIComponent(f.email)}">Ответить на email</a>
          ${f.status !== 'read' ? '<button type="button" class="admin-action-btn" data-feedback-action="read">Отметить прочитанным</button>' : ''}
          ${f.status !== 'closed' ? '<button type="button" class="admin-action-btn" data-feedback-action="close">Закрыть</button>' : ''}
        </div>
      </div>
    `).join('');
  }

  let feedbackItems = [];
  async function loadFeedback() {
    feedbackList.innerHTML = '<p class="community-empty">Загрузка…</p>';
    try {
      feedbackItems = await LexPrepApi.adminListHomepageFeedback();
      feedbackLoaded = true;
      renderFeedback(feedbackItems);
    } catch (err) {
      feedbackList.innerHTML = `<p class="community-empty">Не удалось загрузить: ${escapeHtml(err.message)}</p>`;
    }
  }

  feedbackRefreshBtn.addEventListener('click', loadFeedback);

  feedbackList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-feedback-action]');
    if (!btn) return;
    const item = btn.closest('[data-feedback-id]');
    const id = item.dataset.feedbackId;
    const fb = feedbackItems.find(f => String(f.id) === id);
    try {
      const status = btn.dataset.feedbackAction === 'close' ? 'closed' : 'read';
      await LexPrepApi.adminSetFeedbackStatus(id, status);
      await LexPrepApi.logAdminAction(status === 'closed' ? 'close-feedback' : 'read-feedback', { targetLabel: fb && `${fb.name} <${fb.email}>` });
      await loadFeedback();
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

  let suggestions = [];
  async function loadSuggestions() {
    suggestionsList.innerHTML = '<p class="community-empty">Загрузка…</p>';
    try {
      suggestions = await LexPrepApi.listSuggestions();
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
    const suggestion = suggestions.find(s => String(s.id) === id);
    try {
      if (action === 'comment') {
        const comment = prompt('Комментарий команды:', '');
        if (comment === null) return;
        await LexPrepApi.adminUpdateSuggestion(id, { adminComment: comment.trim() });
        await LexPrepApi.logAdminAction('comment-suggestion', { targetUserId: suggestion && suggestion.userId, targetLabel: suggestion && suggestion.title, details: comment.trim() });
      } else {
        await LexPrepApi.adminUpdateSuggestion(id, { status: action });
        await LexPrepApi.logAdminAction('suggestion-status', { targetUserId: suggestion && suggestion.userId, targetLabel: suggestion && suggestion.title, details: action });
      }
      await loadSuggestions();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  });
});
