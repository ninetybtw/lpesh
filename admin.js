/* ==========================================================================
ADMIN.JS — панель администратора: список аккаунтов из Supabase (profiles),
реальные бан/удаление/правки имени и аватара, выдача бонусных монет и
подписки. Доступ проверяется дважды: здесь по profiles.is_admin (RLS сам
не даст обычному пользователю прочитать чужие строки) и ещё раз на
сервере в Edge Function для удаления аккаунта.
========================================================================== */

const PLAN_TITLES = { basic: 'Базовая', pro: 'Про', max: 'Максимум' };

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
});
