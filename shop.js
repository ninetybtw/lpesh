/* ==========================================================================
SHOP.JS — обмен монет (заработанных в тренажёре) на временный апгрейд
тарифа. Всё хранится только в localStorage этого браузера — демо-симуляция
оплаты. Дневные/месячные лимиты по тарифу реально проверяются (см. plan.js,
progress.js), а докупленные здесь расходники (попытки теста, запросы ИИ,
билеты турнира) реально тратятся сверх лимита. Когда появится бэкенд, эта
механика должна быть переписана на реальный запрос к серверу, который
проверяет баланс и продлевает подписку на своей стороне.

Цены рассчитаны так, чтобы обычная активная подготовка (несколько тестов
в неделю + ежедневное повторение карточек) давала около 300–400 монет
в месяц — то есть каждый апгрейд требует примерно 2 месяца накоплений.
Если реальная скорость набора монет в игре окажется другой, поправьте
price у соответствующего товара — остальной код менять не нужно.
========================================================================== */

const PLAN_TIER_KEY = 'lexprep_plan_tier';
const PLAN_EXPIRES_KEY = 'lexprep_plan_expires';
const PLAN_TITLES = { basic: 'Базовая', pro: 'Про', max: 'Максимум' };

const SHOP_ITEMS = [
  {
    id: 'upgrade-pro-30',
    title: 'Тариф «Про» на 30 дней',
    desc: 'Апгрейд с тарифа «Базовая» до «Про» на 30 дней.',
    price: 650,
    requiresTier: 'basic',
    grantsTier: 'pro'
  },
  {
    id: 'upgrade-max-30',
    title: 'Тариф «Максимум» на 30 дней',
    desc: 'Апгрейд с тарифа «Про» до «Максимум» на 30 дней. Доступен только при активном «Про».',
    price: 900,
    requiresTier: 'pro',
    grantsTier: 'max'
  }
];

const CONSUMABLE_ITEMS = [
  {
    id: 'test-attempts-2',
    title: '2 попытки теста',
    desc: 'Дополнительные попытки прохождения теста сверх дневного лимита.',
    price: 100,
    amount: 2,
    unit: 'попыт.',
    inventoryKey: 'testAttempts',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
  },
  {
    id: 'ai-requests-3',
    title: '3 запроса ИИ-консультанту',
    desc: 'Дополнительные запросы к ИИ-консультанту сверх дневного лимита.',
    price: 120,
    amount: 3,
    unit: 'запр.',
    inventoryKey: 'aiRequests',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  },
  {
    id: 'tourney-ticket-1',
    title: 'Билет участия в турнире',
    desc: 'Один билет на турнир — не тратит обычный взнос монетами.',
    price: 70,
    amount: 1,
    unit: 'билет',
    inventoryKey: 'tourneyTickets',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 5H3v2a4 4 0 0 0 4 4M17 5h4v2a4 4 0 0 1-4 4"/></svg>'
  }
];

// Разрешение тарифа теперь общее для всего сайта — см. plan.js.
function getEffectivePlan() {
  return LexPrepPlan.getEffectivePlan();
}

function getActivePlanTier() {
  return LexPrepPlan.getTier();
}

function getPlanDaysLeft() {
  const expires = getEffectivePlan().expires;
  return Math.max(0, Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000)));
}

function activatePlan(tier) {
  localStorage.setItem(PLAN_TIER_KEY, tier);
  localStorage.setItem(PLAN_EXPIRES_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000));
}

document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }

  const avatarPreview = document.getElementById('shopAvatarPreview');
  const balanceEl = document.getElementById('shopBalance');
  const planEl = document.getElementById('shopCurrentPlan');
  const grid = document.getElementById('shopGrid');
  const consumableGrid = document.getElementById('shopConsumableGrid');

  function renderAvatar() {
    if (user.avatar) {
      avatarPreview.textContent = '';
      avatarPreview.style.backgroundImage = `url(${user.avatar})`;
    } else {
      avatarPreview.textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
    }
    avatarPreview.className = 'profile-avatar-editor__preview shop-balance__avatar';
    const equipped = localStorage.getItem('lexprep_shop_equipped');
    if (equipped && equipped !== 'none') {
      avatarPreview.classList.add(`avatar-frame--${equipped}`);
    }
  }

  function renderGrid() {
    const balance = LexPrepProgress.getCoins();
    balanceEl.textContent = balance;

    const activeTier = getActivePlanTier();
    const daysLeft = getPlanDaysLeft();
    planEl.textContent = activeTier === 'basic'
      ? 'Текущий тариф: Базовая'
      : `Текущий тариф: ${PLAN_TITLES[activeTier]} (осталось ${daysLeft} дн.)`;

    grid.innerHTML = SHOP_ITEMS.map(item => {
      const canAfford = balance >= item.price;
      const meetsRequirement = activeTier === item.requiresTier;
      const alreadyActive = activeTier === item.grantsTier;

      let actionHtml;
      if (alreadyActive) {
        actionHtml = `<button class="btn btn--outline shop-item__btn" type="button" disabled>Активен ещё ${daysLeft} дн.</button>`;
      } else if (!meetsRequirement) {
        actionHtml = `<button class="btn btn--outline shop-item__btn" type="button" disabled>Нужен тариф «${PLAN_TITLES[item.requiresTier]}»</button>`;
      } else if (canAfford) {
        actionHtml = `<button class="btn btn--primary shop-item__btn" type="button" data-buy="${item.id}">Купить за ${item.price}</button>`;
      } else {
        actionHtml = `<button class="btn btn--outline shop-item__btn" type="button" disabled>Не хватает монет</button>`;
      }

      return `
        <div class="shop-item">
          <div class="shop-item__preview shop-item__preview--plan">
            <span class="shop-item__plan-badge">${escapeHtml(PLAN_TITLES[item.grantsTier])}</span>
          </div>
          <div class="shop-item__title">${escapeHtml(item.title)}</div>
          <div class="shop-item__desc">${escapeHtml(item.desc)}</div>
          <div class="shop-item__price">${item.price} монет</div>
          ${actionHtml}
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-buy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.buy;
        const item = SHOP_ITEMS.find(i => i.id === id);
        if (!item) return;
        if (getActivePlanTier() !== item.requiresTier) return;
        if (!LexPrepProgress.spendCoins(item.price)) return;
        activatePlan(item.grantsTier);
        renderGrid();
        renderConsumables();
        if (typeof initCoinBadge === 'function') initCoinBadge();
      });
    });
  }

  function renderConsumables() {
    if (!consumableGrid) return;
    const balance = LexPrepProgress.getCoins();
    const inventory = LexPrepProgress.getInventory();

    consumableGrid.innerHTML = CONSUMABLE_ITEMS.map(item => {
      const canAfford = balance >= item.price;
      const owned = inventory[item.inventoryKey] || 0;
      const actionHtml = canAfford
        ? `<button class="btn btn--primary shop-item__btn" type="button" data-buy-consumable="${item.id}">Купить за ${item.price}</button>`
        : `<button class="btn btn--outline shop-item__btn" type="button" disabled>Не хватает монет</button>`;

      return `
        <div class="shop-item">
          <div class="shop-item__preview shop-item__preview--icon">
            <span class="shop-item__icon-badge">${item.icon}</span>
          </div>
          <div class="shop-item__title">${escapeHtml(item.title)}</div>
          <div class="shop-item__desc">${escapeHtml(item.desc)}</div>
          <div class="shop-item__owned">У тебя: ${owned} ${escapeHtml(item.unit)}</div>
          <div class="shop-item__price">${item.price} монет</div>
          ${actionHtml}
        </div>
      `;
    }).join('');

    consumableGrid.querySelectorAll('[data-buy-consumable]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.buyConsumable;
        const item = CONSUMABLE_ITEMS.find(i => i.id === id);
        if (!item) return;
        if (!LexPrepProgress.spendCoins(item.price)) return;
        LexPrepProgress.addInventory(item.inventoryKey, item.amount);
        renderGrid();
        renderConsumables();
        if (typeof initCoinBadge === 'function') initCoinBadge();
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  renderAvatar();
  renderGrid();
  renderConsumables();
});
