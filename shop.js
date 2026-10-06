/* ==========================================================================
SHOP.JS — обмен монет (заработанных в тренажёре) на временный апгрейд
тарифа. Оплата и баланс монет — демо-симуляция в localStorage этого
браузера. Дневные/месячные лимиты по тарифу реально проверяются (см.
plan.js, progress.js), а докупленные здесь расходники реально тратятся
сверх лимита: попытки теста и билеты турнира — из localStorage-инвентаря
(LexPrepProgress.spendInventory, проверяется в app.js/tournaments.js),
запросы ИИ-консультанту — единственный расходник, реально живущий на
сервере (profiles.ai_extra_requests, списывается Edge Function'ей
ai-consultant, см. supabase/ai-extra-requests.sql) — это обязательно,
иначе клиентский счётчик никак не повлиял бы на серверную проверку
лимита. Когда появится бэкенд, вся эта механика должна быть переписана
на реальный запрос к серверу, который проверяет баланс и продлевает
подписку на своей стороне.

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
    iconName: 'check',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
  },
  {
    id: 'ai-requests-3',
    title: '3 запроса ИИ-консультанту',
    desc: 'Дополнительные запросы к ИИ-консультанту сверх дневного лимита.',
    price: 120,
    amount: 3,
    unit: 'запр.',
    // Единственный товар, который реально расходуется не в этом браузере,
    // а на сервере (Edge Function ai-consultant списывает
    // profiles.ai_extra_requests сама, когда дневной лимит тарифа
    // исчерпан) — остальные расходники (тесты, билеты турнира) тратятся
    // из localStorage-инвентаря, см. LexPrepProgress.spendInventory.
    serverBacked: true,
    iconName: 'bot-medium',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  },
  {
    id: 'tourney-ticket-1',
    title: 'Билет участия в турнире',
    desc: 'Даёт один турнир сверх месячного лимита по тарифу. Участие в турнирах бесплатное — билет нужен только когда лимит уже исчерпан.',
    price: 70,
    amount: 1,
    unit: 'билет',
    inventoryKey: 'tourneyTickets',
    iconName: 'ticket',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 5H3v2a4 4 0 0 0 4 4M17 5h4v2a4 4 0 0 1-4 4"/></svg>'
  }
];

// Что даёт тариф — берём из настоящих лимитов (plan.js), чтобы витрина не
// расходилась с тем, что реально проверяется в тренажёре.
function planFeatures(tier) {
  const limits = typeof LexPrepPlan !== 'undefined' && LexPrepPlan.LIMITS[tier] ? LexPrepPlan.LIMITS[tier].monthly : null;
  if (!limits) return [];
  const per = (n, one, few, many, tail) => {
    if (n === Infinity) return null;
    const abs = n % 100;
    const last = n % 10;
    const word = abs > 10 && abs < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
    return `${n} ${word} ${tail}`;
  };
  return [
    limits.cardsPerDay === Infinity ? 'Карточки без лимита' : per(limits.cardsPerDay, 'карточка', 'карточки', 'карточек', 'в день'),
    limits.testsPerDay === Infinity ? 'Тесты без лимита' : per(limits.testsPerDay, 'тест', 'теста', 'тестов', 'в день'),
    limits.testExplanations ? 'Разбор ошибок в тестах' : null,
    limits.duelsPerDay === Infinity ? 'Дуэли без лимита' : per(limits.duelsPerDay, 'дуэль', 'дуэли', 'дуэлей', 'в день'),
    per(limits.tourneysPerMonth, 'турнир', 'турнира', 'турниров', 'в месяц'),
    limits.examAttemptsPerMonth === Infinity ? 'Пробные экзамены без лимита' : per(limits.examAttemptsPerMonth, 'пробный экзамен', 'пробных экзамена', 'пробных экзаменов', 'в месяц'),
    limits.pdfExport ? 'Скачивание конспектов в PDF' : null
  ].filter(Boolean);
}

function shopIcon(name, cls) {
  return typeof LexPrepIcon === 'function'
    ? LexPrepIcon(name, cls)
    : `<img class="lp-icon ${cls || ''}" src="assets/icons/${name}.svg" alt="" aria-hidden="true" />`;
}

function coinsWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'монет';
  if (last === 1) return 'монета';
  if (last >= 2 && last <= 4) return 'монеты';
  return 'монет';
}

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

document.addEventListener('DOMContentLoaded', async () => {
  let user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = '/auth';
    return;
  }

  // aiExtraRequests живёт на сервере (списывается Edge Function'ей вне
  // этого браузера) — кэш в localStorage может быть устаревшим, поэтому
  // подтягиваем свежий профиль перед тем, как показывать магазин.
  if (typeof LexPrepApi !== 'undefined') {
    try {
      const fresh = await LexPrepApi.me();
      user = { ...user, ...fresh };
      localStorage.setItem('lexprep_user', JSON.stringify(user));

      // Разовая миграция: раньше "запросы ИИ" писались только в локальный
      // инвентарь (см. историю CONSUMABLE_ITEMS выше) и никогда не
      // работали — сервер про них не знал. Если у кого-то остался такой
      // неиспользованный (и по сути пропавший впустую) остаток, зачисляем
      // его на настоящий серверный счётчик один раз и обнуляем локальный.
      const staleAiRequests = LexPrepProgress.getInventory().aiRequests || 0;
      if (staleAiRequests > 0) {
        const migrated = await LexPrepApi.addAiExtraRequests(staleAiRequests, user.aiExtraRequests || 0);
        user = { ...user, ...migrated };
        localStorage.setItem('lexprep_user', JSON.stringify(user));
        LexPrepProgress.addInventory('aiRequests', -staleAiRequests);
      }
    } catch (e) { /* остаёмся на кэше, если сеть недоступна */ }
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

  const planBar = document.getElementById('shopPlanBar');
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setBalance(balance) {
    const prev = Number(balanceEl.textContent);
    if (window.LexPrepMotion && !reduced() && balanceEl.dataset.ready && prev !== balance) {
      LexPrepMotion.countTo(balanceEl, balance, 900);
    } else {
      balanceEl.textContent = balance;
    }
    balanceEl.dataset.ready = '1';
  }

  // Сколько накоплено до цены товара — полоска на карточке, если не хватает.
  function progressHtml(balance, price) {
    const pct = Math.min(100, Math.round((balance / price) * 100));
    return `
      <div class="shop-progress" aria-label="Накоплено ${balance} из ${price}">
        <span class="shop-progress__bar"><span style="--w: ${pct}%"></span></span>
        <span class="shop-progress__text">Ещё ${price - balance} ${coinsWord(price - balance)} · ${pct}%</span>
      </div>`;
  }

  function renderGrid() {
    const balance = LexPrepProgress.getCoins();
    setBalance(balance);

    const activeTier = getActivePlanTier();
    const daysLeft = getPlanDaysLeft();
    planEl.innerHTML = activeTier === 'basic'
      ? 'Тариф <b>«Базовая»</b>'
      : `Тариф <b>«${escapeHtml(PLAN_TITLES[activeTier])}»</b> · осталось ${daysLeft} дн.`;
    if (planBar) {
      planBar.hidden = activeTier === 'basic';
      planBar.firstElementChild.style.setProperty('--w', `${Math.min(100, Math.round((daysLeft / 30) * 100))}%`);
    }

    grid.innerHTML = SHOP_ITEMS.map(item => {
      const canAfford = balance >= item.price;
      const meetsRequirement = activeTier === item.requiresTier;
      const alreadyActive = activeTier === item.grantsTier;
      const rank = LexPrepPlan.TIER_RANK || { basic: 0, pro: 1, max: 2 };
      const alreadyHigher = rank[activeTier] > rank[item.grantsTier];

      let actionHtml;
      let state = '';
      if (alreadyHigher) {
        state = 'is-covered';
        actionHtml = `<button class="shop-buy shop-buy--ghost" type="button" disabled>Уже входит в «${escapeHtml(PLAN_TITLES[activeTier])}»</button>`;
      } else if (alreadyActive) {
        state = 'is-active';
        actionHtml = `<button class="shop-buy shop-buy--ghost" type="button" disabled>Активен ещё ${daysLeft} дн.</button>`;
      } else if (!meetsRequirement) {
        state = 'is-locked';
        actionHtml = `<button class="shop-buy shop-buy--ghost" type="button" disabled>Нужен тариф «${escapeHtml(PLAN_TITLES[item.requiresTier])}»</button>`;
      } else if (canAfford) {
        actionHtml = `<button class="shop-buy" type="button" data-buy="${item.id}">Купить за ${shopIcon('coin')}<b>${item.price}</b></button>`;
      } else {
        state = 'is-short';
        actionHtml = `${progressHtml(balance, item.price)}<button class="shop-buy shop-buy--ghost" type="button" disabled>Не хватает монет</button>`;
      }

      return `
        <article class="shop-plan shop-plan--${item.grantsTier} ${state}" data-item="${item.id}">
          ${alreadyActive ? '<span class="shop-plan__ribbon">Активен</span>' : ''}
          ${!alreadyActive && !alreadyHigher && !meetsRequirement ? `<span class="shop-plan__lock" title="Нужен тариф «${escapeHtml(PLAN_TITLES[item.requiresTier])}»"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>` : ''}
          <div class="shop-plan__head">
            <div class="shop-plan__top">
              <span class="shop-plan__icon">${shopIcon(item.grantsTier === 'max' ? 'crown' : 'star')}</span>
              <div>
                <span class="shop-plan__tier">${escapeHtml(PLAN_TITLES[item.grantsTier])}</span>
                <h3 class="shop-plan__title">${escapeHtml(item.title)}</h3>
              </div>
            </div>
            <p class="shop-plan__desc">${escapeHtml(item.desc)}</p>
          </div>
          <ul class="shop-plan__features">
            ${planFeatures(item.grantsTier).map(f => `<li>${escapeHtml(f)}</li>`).join('')}
          </ul>
          <div class="shop-plan__price">${shopIcon('coin')}<b>${item.price}</b><span>монет · 30 дней</span></div>
          ${actionHtml}
        </article>
      `;
    }).join('');

    grid.querySelectorAll('[data-buy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.buy;
        const item = SHOP_ITEMS.find(i => i.id === id);
        if (!item) return;
        if (!(await confirmPurchase(item))) return;
        if (getActivePlanTier() !== item.requiresTier) return;
        if (!LexPrepProgress.spendCoins(item.price)) return;
        activatePlan(item.grantsTier);
        celebrate(btn, `Тариф «${PLAN_TITLES[item.grantsTier]}» активирован на 30 дней`, true);
        renderGrid();
        renderConsumables();
        if (typeof initCoinBadge === 'function') initCoinBadge();
        if (typeof LexPrepApi !== 'undefined' && LexPrepApi.createSelfNotification) {
          LexPrepApi.createSelfNotification({
            type: 'subscription',
            title: `Подписка «${PLAN_TITLES[item.grantsTier]}» активирована`,
            body: 'Действует 30 дней — новые возможности уже доступны.',
            link: '/profile#subscription'
          }).catch(() => {});
        }
      });
    });
  }

  function renderConsumables() {
    if (!consumableGrid) return;
    const balance = LexPrepProgress.getCoins();
    const inventory = LexPrepProgress.getInventory();

    consumableGrid.innerHTML = CONSUMABLE_ITEMS.map(item => {
      const canAfford = balance >= item.price;
      const owned = item.serverBacked ? (user.aiExtraRequests || 0) : (inventory[item.inventoryKey] || 0);
      const actionHtml = canAfford
        ? `<button class="shop-buy" type="button" data-buy-consumable="${item.id}">${shopIcon('coin')}<b>${item.price}</b></button>`
        : `<button class="shop-buy shop-buy--ghost" type="button" disabled>${shopIcon('coin')}<b>${item.price}</b></button>`;

      return `
        <article class="shop-boost shop-boost--${item.iconName} ${canAfford ? '' : 'is-short'}" data-item="${item.id}">
          <span class="shop-boost__icon">${shopIcon(item.iconName)}</span>
          <div class="shop-boost__body">
            <h3 class="shop-boost__title">${escapeHtml(item.title)}</h3>
            <p class="shop-boost__desc">${escapeHtml(item.desc)}</p>
            <span class="shop-boost__owned ${owned ? 'has-items' : ''}">У тебя: <b>${owned}</b> ${escapeHtml(item.unit)}</span>
            ${canAfford ? '' : progressHtml(balance, item.price)}
          </div>
          <div class="shop-boost__action">${actionHtml}</div>
        </article>
      `;
    }).join('');

    consumableGrid.querySelectorAll('[data-buy-consumable]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.buyConsumable;
        const item = CONSUMABLE_ITEMS.find(i => i.id === id);
        if (!item) return;
        if (!(await confirmPurchase(item))) return;

        if (item.serverBacked) {
          if (LexPrepProgress.getCoins() < item.price) return;
          // Списываем монеты только после того, как сервер подтвердил
          // начисление — иначе при сетевой ошибке деньги ушли бы, а
          // запросы не появились.
          btn.disabled = true;
          try {
            const updated = await LexPrepApi.addAiExtraRequests(item.amount, user.aiExtraRequests || 0);
            user = { ...user, ...updated };
            localStorage.setItem('lexprep_user', JSON.stringify(user));
            LexPrepProgress.spendCoins(item.price);
          } catch (err) {
            alert('Не удалось купить: ' + err.message);
            btn.disabled = false;
            return;
          }
        } else {
          if (!LexPrepProgress.spendCoins(item.price)) return;
          LexPrepProgress.addInventory(item.inventoryKey, item.amount);
        }

        celebrate(btn, `Куплено: ${item.title}`, false);
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

  // Монеты — не мелочь (апгрейд копится месяцами), поэтому перед списанием
  // спрашиваем подтверждение.
  function confirmPurchase(item) {
    const text = `Купить «${item.title}» за ${item.price} ${coinsWord(item.price)}? После покупки останется ${LexPrepProgress.getCoins() - item.price}.`;
    if (typeof LexPrepDialog !== 'undefined' && LexPrepDialog.confirm) return LexPrepDialog.confirm(text);
    return Promise.resolve(window.confirm(text));
  }

  const walletEl = document.getElementById('shopWallet');
  const walletCoin = document.getElementById('shopWalletCoin');

  // После покупки: монеты улетают из кнопки в кошелёк, кошелёк «ёкает»,
  // внизу — короткое уведомление. За тариф — ещё и конфетти.
  function celebrate(fromEl, message, big) {
    showToast(message);
    if (reduced() || !walletCoin) return;
    const from = fromEl.getBoundingClientRect();
    const to = walletCoin.getBoundingClientRect();
    const count = big ? 9 : 5;
    for (let i = 0; i < count; i++) {
      const coin = document.createElement('img');
      coin.src = 'assets/icons/coin.svg';
      coin.alt = '';
      coin.className = 'shop-fly-coin';
      coin.style.left = `${from.left + from.width / 2 - 14 + (Math.random() - 0.5) * 40}px`;
      coin.style.top = `${from.top + from.height / 2 - 14}px`;
      coin.style.setProperty('--dx', `${to.left + to.width / 2 - (from.left + from.width / 2)}px`);
      coin.style.setProperty('--dy', `${to.top + to.height / 2 - (from.top + from.height / 2)}px`);
      coin.style.animationDelay = `${i * 60}ms`;
      coin.addEventListener('animationend', () => coin.remove());
      document.body.appendChild(coin);
    }
    setTimeout(() => {
      if (!walletEl) return;
      walletEl.classList.remove('is-bump');
      void walletEl.offsetWidth;
      walletEl.classList.add('is-bump');
    }, 650);
    // Кнопка к этому моменту уже перерисована — конфетти пускаем из кошелька.
    if (big && window.LexPrepMotion) setTimeout(() => LexPrepMotion.confetti(walletCoin), 650);
  }

  let toastTimer = null;
  function showToast(message) {
    let toast = document.getElementById('shopToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'shopToast';
      toast.className = 'shop-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.innerHTML = `${shopIcon('check')}<span>${escapeHtml(message)}</span>`;
    toast.classList.remove('is-visible');
    void toast.offsetWidth;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  // Разделы: всё / подписка / бустеры.
  document.querySelectorAll('[data-shop-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.shopFilter;
      document.querySelectorAll('[data-shop-filter]').forEach(b => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      document.querySelectorAll('[data-shop-section]').forEach(section => {
        const show = filter === 'all' || section.dataset.shopSection === filter;
        section.hidden = !show;
        if (show && !reduced()) {
          section.classList.remove('is-entering');
          void section.offsetWidth;
          section.classList.add('is-entering');
        }
      });
    });
  });

  /* ---------------- Промокод ---------------- */
  const promoInput = document.getElementById('shopPromoInput');
  const promoBtn = document.getElementById('shopPromoBtn');
  const promoStatus = document.getElementById('shopPromoStatus');

  if (promoBtn) {
    promoBtn.addEventListener('click', async () => {
      const code = promoInput.value.trim();
      if (!code || typeof LexPrepApi === 'undefined') return;
      promoBtn.disabled = true;
      promoStatus.hidden = true;
      try {
        const result = await LexPrepApi.redeemPromoCode(code);
        let message;
        // Подписка/монеты/скидка уже записаны на сервере — подтягиваем
        // свежий профиль, чтобы тариф и баланс обновились без перезагрузки.
        try {
          const fresh = await LexPrepApi.me();
          user = { ...user, ...fresh };
          localStorage.setItem('lexprep_user', JSON.stringify(user));
        } catch (e) { /* профиль обновится при следующей загрузке страницы */ }
        if (result.type === 'subscription') {
          message = `Готово! Подписка «${PLAN_TITLES[result.subscriptionTier]}» на ${result.subscriptionDays} дн.`;
        } else if (result.type === 'coins') {
          message = `Готово! Начислено ${result.coinsAmount} монет.`;
        } else if (result.type === 'discount') {
          message = `Готово! Скидка ${result.discountPercent}% учтётся при следующей оплате.`;
        } else {
          message = 'Промокод активирован.';
        }
        promoStatus.textContent = message;
        promoStatus.className = 'shop-promo__status is-success';
        promoStatus.hidden = false;
        promoInput.value = '';
        renderGrid();
        renderConsumables();
      } catch (err) {
        promoStatus.textContent = err.message;
        promoStatus.className = 'shop-promo__status is-error';
        promoStatus.hidden = false;
      } finally {
        promoBtn.disabled = false;
      }
    });
  }

  renderAvatar();
  renderGrid();
  renderConsumables();
  if (window.LexPrepMotion) {
    LexPrepMotion.stagger(grid, '.shop-plan', 150);
    LexPrepMotion.stagger(consumableGrid, '.shop-boost', 300);
  }
});
