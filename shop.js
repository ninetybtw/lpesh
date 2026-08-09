/* ==========================================================================
SHOP.JS — магазин косметических наград за монеты, заработанные в тренажёре.
Всё хранится только в localStorage этого браузера (демо, без бэкенда).
========================================================================== */

const SHOP_ITEMS = [
  { id: 'none', title: 'Без рамки', desc: 'Стандартный вид аватара', price: 0, frameClass: '' },
  { id: 'bronze', title: 'Бронзовая рамка', desc: 'Тёплый бронзовый акцент вокруг аватара', price: 40, frameClass: 'avatar-frame--bronze' },
  { id: 'neon-blue', title: 'Неоновая синяя', desc: 'Яркое голубое свечение вокруг аватара', price: 70, frameClass: 'avatar-frame--neon-blue' },
  { id: 'neon-purple', title: 'Неоновая фиолетовая', desc: 'Яркое фиолетовое свечение вокруг аватара', price: 70, frameClass: 'avatar-frame--neon-purple' },
  { id: 'gold', title: 'Золотая рамка', desc: 'Статусный золотой блеск', price: 90, frameClass: 'avatar-frame--gold' },
  { id: 'platinum', title: 'Платиновая рамка', desc: 'Холодный премиальный блеск', price: 160, frameClass: 'avatar-frame--platinum' },
  { id: 'ruby', title: 'Рубиновая рамка', desc: 'Редкий рубиновый акцент для топ-уровня', price: 220, frameClass: 'avatar-frame--ruby' }
];

function getOwnedItems() {
  const owned = JSON.parse(localStorage.getItem('lexprep_shop_owned') || '["none"]');
  return owned.includes('none') ? owned : ['none', ...owned];
}

function getEquippedItem() {
  return localStorage.getItem('lexprep_shop_equipped') || 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }

  const avatarPreview = document.getElementById('shopAvatarPreview');
  const balanceEl = document.getElementById('shopBalance');
  const grid = document.getElementById('shopGrid');

  function renderAvatar() {
    if (user.avatar) {
      avatarPreview.textContent = '';
      avatarPreview.style.backgroundImage = `url(${user.avatar})`;
    } else {
      avatarPreview.textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
    }
    avatarPreview.className = 'profile-avatar-editor__preview shop-balance__avatar';
    const equipped = getEquippedItem();
    if (equipped !== 'none') {
      const item = SHOP_ITEMS.find(i => i.id === equipped);
      if (item) avatarPreview.classList.add(item.frameClass);
    }
  }

  function renderGrid() {
    const balance = LexPrepProgress.getCoins();
    balanceEl.textContent = balance;

    const owned = getOwnedItems();
    const equipped = getEquippedItem();

    grid.innerHTML = SHOP_ITEMS.map(item => {
      const isOwned = owned.includes(item.id);
      const isEquipped = equipped === item.id;
      const canAfford = balance >= item.price;

      let actionHtml;
      if (isEquipped) {
        actionHtml = `<button class="btn btn--outline shop-item__btn" type="button" disabled>Надето</button>`;
      } else if (isOwned) {
        actionHtml = `<button class="btn btn--primary shop-item__btn" type="button" data-equip="${item.id}">Надеть</button>`;
      } else if (canAfford) {
        actionHtml = `<button class="btn btn--primary shop-item__btn" type="button" data-buy="${item.id}">Купить за ${item.price}</button>`;
      } else {
        actionHtml = `<button class="btn btn--outline shop-item__btn" type="button" disabled>Не хватает монет</button>`;
      }

      return `
        <div class="shop-item">
          <div class="shop-item__preview">
            <span class="shop-item__avatar ${item.frameClass}">${(user.name || 'U').trim().charAt(0).toUpperCase()}</span>
          </div>
          <div class="shop-item__title">${escapeHtml(item.title)}</div>
          <div class="shop-item__desc">${escapeHtml(item.desc)}</div>
          <div class="shop-item__price">${item.price === 0 ? 'Бесплатно' : `${item.price} монет`}</div>
          ${actionHtml}
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-buy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.buy;
        const item = SHOP_ITEMS.find(i => i.id === id);
        if (!item) return;
        if (!LexPrepProgress.spendCoins(item.price)) return;
        const ownedNow = getOwnedItems();
        ownedNow.push(id);
        localStorage.setItem('lexprep_shop_owned', JSON.stringify(ownedNow));
        localStorage.setItem('lexprep_shop_equipped', id);
        renderGrid();
        renderAvatar();
      });
    });

    grid.querySelectorAll('[data-equip]').forEach(btn => {
      btn.addEventListener('click', () => {
        localStorage.setItem('lexprep_shop_equipped', btn.dataset.equip);
        renderGrid();
        renderAvatar();
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
