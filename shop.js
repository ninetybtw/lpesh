/* ==========================================================================
SHOP.JS — обмен монет (заработанных в тренажёре) на временный апгрейд
тарифа. Всё хранится только в localStorage этого браузера — демо-симуляция,
без реальной оплаты и без технической защиты лимитов. Когда появится
бэкенд, эта механика должна быть переписана на реальный запрос к серверу,
который проверяет баланс и продлевает подписку на своей стороне.

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

function getActivePlanTier() {
  const tier = localStorage.getItem(PLAN_TIER_KEY) || 'basic';
  if (tier === 'basic') return 'basic';
  const expires = Number(localStorage.getItem(PLAN_EXPIRES_KEY) || 0);
  if (Date.now() > expires) {
    localStorage.removeItem(PLAN_TIER_KEY);
    localStorage.removeItem(PLAN_EXPIRES_KEY);
    return 'basic';
  }
  return tier;
}

function getPlanDaysLeft() {
  const expires = Number(localStorage.getItem(PLAN_EXPIRES_KEY) || 0);
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
});
