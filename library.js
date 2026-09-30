/* ==========================================================================
LIBRARY.JS — «Библиотека» (library.html): полка сборников билетов,
оглавление сборника и читалка.

Каталог и оглавление приходят из public.library_collections/library_items
(открыты всем — это витрина). Текст билета отдаёт только RPC
library_read_item: сервер сам проверяет тариф «Про»/«Максимум» и суточный
лимит (supabase/library.sql), поэтому доступ нельзя «включить» правкой
localStorage. Текст держим только в памяти вкладки — ни в localStorage, ни
в IndexedDB он не попадает.

Файлов для скачивания нет: билет рисуется как HTML внутри страницы.
Выделение, копирование, контекстное меню, перетаскивание схем, печать и
Ctrl+S/P/C/A в читалке заблокированы, поверх текста — водяной знак с email
читателя, чтобы скриншот можно было отследить.

Маршруты — в hash: #c/<id сборника> — оглавление, #t/<id билета> — билет.
?d=<discipline_id> в адресе сразу выбирает дисциплину на полке.
========================================================================== */

(function () {
  const READ_KEY = 'lexprep_library_read';
  const LAST_KEY = 'lexprep_library_last';
  const FONT_KEY = 'lexprep_library_font';
  const FONT_STEPS = [15, 16.5, 18, 19.5, 21];
  const WORDS_PER_MINUTE = 170;

  const DISCIPLINE_COLORS = {
    'criminal-law': ['#e5484d', '#9f1f2c'],
    'criminal-procedure': ['#f97316', '#b4460b'],
    civil: ['#3d5afe', '#1f2fb8'],
    'civil-procedure': ['#0ea5a4', '#0b6d6c'],
    administrative: ['#8c54ff', '#5a2cc7'],
    'administrative-law': ['#8c54ff', '#5a2cc7'],
    constitutional: ['#d99a0b', '#9a6a05'],
    tgp: ['#1fb774', '#12784b'],
    'labor-law': ['#0891b2', '#075e75'],
    'financial-law': ['#059669', '#04664a'],
    'international-law': ['#2563eb', '#173f9e'],
    igpzs: ['#b45309', '#7a3806'],
    iogp: ['#be185d', '#7f0f3e']
  };
  const PALETTE = [
    ['#3d5afe', '#1f2fb8'], ['#8c54ff', '#5a2cc7'], ['#e5484d', '#9f1f2c'], ['#0ea5a4', '#0b6d6c'],
    ['#f97316', '#b4460b'], ['#1fb774', '#12784b'], ['#d99a0b', '#9a6a05'], ['#be185d', '#7f0f3e']
  ];

  const ICONS = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.4-4.4M10.5 8v5M8 10.5h5"/></svg>'
  };

  const CALLOUT_LABELS = {
    law: 'Норма и практика',
    note: 'Лектор и доктрина',
    warn: 'Обрати внимание'
  };

  const state = {
    user: null,
    status: null,
    collections: [],
    items: [],
    itemsByCollection: new Map(),
    itemsById: new Map(),
    collectionsById: new Map(),
    loaded: false,
    loadError: null,
    filter: 'all',
    query: '',
    part: 'all',
    colQuery: '',
    current: null,
    cache: new Map(),
    blobUrls: [],
    readerToken: 0
  };

  const $ = (id) => document.getElementById(id);

  /* ---------------- Утилиты ---------------- */
  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function plural(n, one, few, many) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function readingTime(words) {
    const minutes = Math.max(1, Math.round((words || 0) / WORDS_PER_MINUTE));
    if (minutes < 60) return `${minutes} мин`;
    const hours = minutes / 60;
    return hours < 10 ? `${hours.toFixed(1).replace('.0', '').replace('.', ',')} ч` : `${Math.round(hours)} ч`;
  }

  function normalize(str) {
    return String(str || '').toLowerCase().replace(/ё/g, 'е');
  }

  function getJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function setJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* хранилище недоступно — не критично */ }
  }

  function colorsFor(collection) {
    if (!collection) return PALETTE[0];
    if (DISCIPLINE_COLORS[collection.disciplineId]) return DISCIPLINE_COLORS[collection.disciplineId];
    const key = collection.disciplineId || collection.disciplineTitle || collection.id;
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(hash) % PALETTE.length];
  }

  // Мягкие переносы в длинных словах названия на обложке — чтобы
  // «Административное» переносилось по слогам, а не вылезало за край.
  function softHyphens(text) {
    return String(text || '').replace(/[А-Яа-яЁё]{12,}/g, word => {
      let out = '';
      for (let i = 0; i < word.length; i++) {
        out += word[i];
        const after = word.length - i - 1;
        if (i >= 2 && after >= 3 && /[аеёиоуыэюя]/i.test(word[i]) && !/[йьъ]/i.test(word[i + 1])) out += '\u00AD';
      }
      return out;
    });
  }

  function bookStyle(collection) {
    const [c1, c2] = colorsFor(collection);
    return `--book:${c1};--book-2:${c2}`;
  }

  function itemLabel(collection) {
    return collection && collection.kind !== 'tickets' ? 'Тема' : 'Билет';
  }

  function kindTitle(collection) {
    return ({ tickets: 'Билеты', lectures: 'Лекции', course: 'Курс', other: 'Сборник' })[collection && collection.kind] || 'Билеты';
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('libToast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.remove('is-visible');
    void el.offsetWidth;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => { el.hidden = true; }, 250);
    }, 2400);
  }

  /* ---------------- Доступ ---------------- */
  function currentUser() {
    try { return JSON.parse(localStorage.getItem('lexprep_user') || 'null'); } catch (e) { return null; }
  }

  // Сервер — единственный источник правды (library_status). Пока ответа
  // нет или функция недоступна, решаем по кэшу профиля — сервер всё
  // равно не отдаст текст без подписки.
  function serverPlanActive(user) {
    if (!user) return false;
    if (user.isAdmin) return true;
    const expires = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : 0;
    return (user.planTier === 'pro' || user.planTier === 'max') && expires > Date.now() && !user.isBanned;
  }

  function hasAccess() {
    if (!state.user) return false;
    if (state.status && state.status.authenticated) return state.status.hasAccess;
    return serverPlanActive(state.user);
  }

  function lockReason() {
    if (!state.user) return 'guest';
    if (hasAccess()) return null;
    const localTier = typeof LexPrepPlan !== 'undefined' ? LexPrepPlan.getTier() : 'basic';
    return localTier === 'pro' || localTier === 'max' ? 'coins' : 'plan';
  }

  function tierTitle() {
    const user = state.user;
    if (user && user.isAdmin && !(state.status && !state.status.isAdmin)) return 'Администратор';
    const tier = user && user.planTier;
    return tier === 'max' ? 'Максимум' : 'Про';
  }

  /* ---------------- Прогресс чтения (только отметки, без текста) ---------------- */
  function readMap() {
    return getJson(READ_KEY, {});
  }

  function markRead(itemId) {
    const map = readMap();
    if (map[itemId]) return false;
    map[itemId] = Date.now();
    setJson(READ_KEY, map);
    return true;
  }

  function lastOpened(collectionId) {
    return getJson(LAST_KEY, {})[collectionId] || null;
  }

  function rememberLast(collectionId, itemId) {
    const map = getJson(LAST_KEY, {});
    map[collectionId] = itemId;
    setJson(LAST_KEY, map);
  }

  function collectionProgress(collectionId) {
    const items = state.itemsByCollection.get(collectionId) || [];
    const read = readMap();
    const done = items.filter(i => read[i.id]).length;
    return { done, total: items.length, percent: items.length ? Math.round((done / items.length) * 100) : 0 };
  }

  /* ---------------- Загрузка ---------------- */
  async function loadCatalog() {
    if (typeof LexPrepApi === 'undefined') {
      state.loadError = new Error('api_unavailable');
      return;
    }
    const statusPromise = LexPrepApi.getLibraryStatus().catch(() => null);
    try {
      const { collections, items } = await LexPrepApi.listLibrary();
      state.collections = collections;
      state.items = items;
    } catch (err) {
      state.loadError = err;
      state.collections = [];
      state.items = [];
    }
    state.status = await statusPromise;
    state.collectionsById = new Map(state.collections.map(c => [c.id, c]));
    state.itemsById = new Map(state.items.map(i => [i.id, i]));
    state.itemsByCollection = new Map();
    state.items.forEach(item => {
      if (!state.collectionsById.has(item.collectionId)) return;
      if (!state.itemsByCollection.has(item.collectionId)) state.itemsByCollection.set(item.collectionId, []);
      state.itemsByCollection.get(item.collectionId).push(item);
    });
    // Сборник без единого билета на полке не показываем.
    state.collections = state.collections.filter(c => state.itemsByCollection.has(c.id));
    state.loaded = true;
  }

  /* ---------------- Полка ---------------- */
  function disciplines() {
    const map = new Map();
    state.collections.forEach(c => {
      const key = c.disciplineId || c.disciplineTitle;
      if (!map.has(key)) map.set(key, { key, title: c.disciplineTitle, count: 0, collection: c });
      map.get(key).count += 1;
    });
    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }

  function renderStats() {
    const el = $('libStats');
    if (!el) return;
    const counts = {
      collections: state.collections.length,
      items: state.collections.reduce((sum, c) => sum + (state.itemsByCollection.get(c.id) || []).length, 0),
      disciplines: disciplines().length
    };
    el.hidden = !counts.collections;
    const words = {
      collections: ['сборник', 'сборника', 'сборников'],
      items: ['билет', 'билета', 'билетов'],
      disciplines: ['дисциплина', 'дисциплины', 'дисциплин']
    };
    Object.keys(counts).forEach(key => {
      const num = el.querySelector(`[data-stat="${key}"]`);
      const word = el.querySelector(`[data-stat-word="${key}"]`);
      if (num) {
        if (window.LexPrepMotion) LexPrepMotion.countTo(num, counts[key], 800);
        else num.textContent = counts[key];
      }
      if (word) word.textContent = plural(counts[key], ...words[key]);
    });
  }

  function renderAccess() {
    const el = $('libAccess');
    if (!el) return;
    if (!state.collections.length) {
      el.hidden = true;
      return;
    }
    const reason = lockReason();
    el.hidden = false;
    el.className = `lib-access ${reason ? 'lib-access--locked' : 'lib-access--open'}`;
    if (!reason) {
      const s = state.status;
      const limitNote = s && s.dailyLimit && !s.isAdmin
        ? `<span class="lib-access__limit" title="Сколько разных билетов можно открыть за сутки">Сегодня открыто ${s.readsToday} из ${s.dailyLimit}</span>`
        : '';
      el.innerHTML = `
        <span class="lib-access__icon lib-access__icon--open">${ICONS.shield}</span>
        <div class="lib-access__text">
          <b>Доступ открыт · ${esc(tierTitle())}</b>
          <p>Билеты читаются только на сайте: скачать, скопировать или распечатать их нельзя.</p>
        </div>
        ${limitNote}`;
      return;
    }
    const copy = {
      guest: {
        title: 'Войди, чтобы читать билеты',
        text: 'Оглавление открыто всем, а сами билеты — на тарифах «Про» и «Максимум».',
        actions: '<a href="auth.html#login" class="btn btn--primary">Войти</a><a href="auth.html#register" class="btn btn--outline">Регистрация</a>'
      },
      plan: {
        title: 'Билеты открываются с тарифом «Про»',
        text: 'Оглавление видно всем, а текст билетов, схемы и сноски — на тарифах «Про» и «Максимум».',
        actions: '<a href="profile.html#subscription" class="btn btn--primary">Оформить «Про»</a><a href="index.html#pricing" class="btn btn--outline">Сравнить тарифы</a>'
      },
      coins: {
        title: 'Нужна оформленная подписка',
        text: 'Тариф за монеты открывает тренажёр, но не библиотеку: сборники доступны с оплаченной подпиской «Про» или «Максимум».',
        actions: '<a href="profile.html#subscription" class="btn btn--primary">Оформить подписку</a>'
      }
    }[reason];
    el.innerHTML = `
      <span class="lib-access__icon">${ICONS.lock}</span>
      <div class="lib-access__text">
        <b>${copy.title}</b>
        <p>${copy.text}</p>
      </div>
      <div class="lib-access__actions">${copy.actions}</div>`;
  }

  function renderFilter() {
    const el = $('libFilter');
    if (!el) return;
    const list = disciplines();
    if (state.filter !== 'all' && !list.some(d => d.key === state.filter)) state.filter = 'all';
    el.innerHTML = [
      `<button type="button" class="lib-chip ${state.filter === 'all' ? 'is-active' : ''}" data-filter="all" role="tab" aria-selected="${state.filter === 'all'}">Все <i>${state.collections.length}</i></button>`,
      ...list.map(d => `
        <button type="button" class="lib-chip ${state.filter === d.key ? 'is-active' : ''}" data-filter="${esc(d.key)}" role="tab" aria-selected="${state.filter === d.key}" style="${bookStyle(d.collection)}">
          <span class="lib-chip__dot"></span>${esc(d.title)} <i>${d.count}</i>
        </button>`)
    ].join('');
    el.hidden = list.length < 2;
  }

  function bookCard(c) {
    const items = state.itemsByCollection.get(c.id) || [];
    const words = items.reduce((sum, i) => sum + (i.wordCount || 0), 0) || c.wordCount;
    const progress = collectionProgress(c.id);
    const locked = !!lockReason();
    const parts = Array.from(new Set(items.map(i => i.part).filter(Boolean)));
    return `
      <a class="lib-book" href="#c/${encodeURIComponent(c.id)}" style="${bookStyle(c)}">
        <div class="lib-book__cover">
          <span class="lib-book__spine" aria-hidden="true"></span>
          <span class="lib-book__kind">${esc(kindTitle(c))}</span>
          <b class="lib-book__name">${esc(softHyphens(c.disciplineTitle))}</b>
          ${c.author ? `<span class="lib-book__author">${esc(c.author)}</span>` : ''}
          <span class="lib-book__count"><b>${items.length}</b>${plural(items.length, 'билет', 'билета', 'билетов')}</span>
          <span class="lib-book__emblem" aria-hidden="true">§</span>
          ${locked ? `<span class="lib-book__lock" title="Нужен тариф «Про» или «Максимум»">${ICONS.lock}</span>` : ''}
        </div>
        <div class="lib-book__info">
          <h3>${esc(c.title)}</h3>
          <div class="lib-book__meta">
            ${parts.length ? `<span>${esc(parts.join(' · '))}</span>` : ''}
            <span>${ICONS.clock}≈ ${readingTime(words)}</span>
          </div>
          <div class="lib-book__progress" aria-label="Прочитано ${progress.done} из ${progress.total}">
            <span style="--p:${progress.percent}%"></span>
          </div>
          <small class="lib-book__progress-text">${progress.done ? `Прочитано ${progress.done} из ${progress.total}` : 'Ещё не начат'}</small>
        </div>
      </a>`;
  }

  function renderShelf(animate) {
    const shelf = $('libShelf');
    const toolbar = $('libToolbar');
    if (!shelf) return;
    renderStats();
    renderAccess();

    if (!state.collections.length) {
      if (toolbar) toolbar.hidden = true;
      const notReady = state.loadError && state.loadError.code === 'library_not_ready';
      const failed = state.loadError && !notReady;
      const adminHint = state.user && state.user.isAdmin && (notReady || !failed)
        ? '<p class="lib-empty__hint">Для админа: выполни <code>supabase/library.sql</code> в SQL Editor и загрузи сборники — они сразу появятся здесь.</p>'
        : '';
      shelf.innerHTML = `
        <div class="lib-empty">
          <div class="lib-empty__art" aria-hidden="true"><img class="lp-icon" src="assets/icons/books.svg" alt="" /></div>
          <b>${failed ? 'Не удалось загрузить библиотеку' : 'Библиотека наполняется'}</b>
          <p>${failed ? 'Проверь интернет и обнови страницу.' : 'Первые сборники билетов появятся здесь совсем скоро.'}</p>
          ${failed ? '<button type="button" class="btn btn--outline" data-reload>Обновить</button>' : ''}
          ${adminHint}
        </div>`;
      return;
    }

    if (toolbar) toolbar.hidden = false;
    renderFilter();
    const shown = state.collections.filter(c => state.filter === 'all' || (c.disciplineId || c.disciplineTitle) === state.filter);
    shelf.innerHTML = shown.map(bookCard).join('') || '<p class="lib-muted">В этой дисциплине пока нет сборников.</p>';
    fitCoverNames(shelf);
    if (animate !== false && window.LexPrepMotion) LexPrepMotion.stagger(shelf, '.lib-book', 80);
    renderSearch();
  }

  // Длинные названия дисциплин («Административное право») уменьшаем,
  // пока самое длинное слово не влезет в обложку.
  function fitCoverNames(root) {
    (root || document).querySelectorAll('.lib-book__name').forEach(el => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      let guard = 0;
      while (el.scrollWidth > el.clientWidth + 1 && size > 12 && guard++ < 14) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    });
  }

  function renderSearch() {
    const box = $('libResults');
    const shelf = $('libShelf');
    if (!box) return;
    const q = normalize(state.query.trim());
    if (q.length < 2) {
      box.hidden = true;
      box.innerHTML = '';
      if (shelf) shelf.hidden = false;
      return;
    }
    const inFilter = (c) => state.filter === 'all' || (c.disciplineId || c.disciplineTitle) === state.filter;
    const results = [];
    state.collections.filter(inFilter).forEach(c => {
      (state.itemsByCollection.get(c.id) || []).forEach(item => {
        const inTitle = normalize(item.title).includes(q);
        const section = !inTitle && item.sections.find(s => normalize(s.title || s.title_raw).includes(q));
        const numberMatch = /^(№|билет|тема)?\s*\d+$/.test(q) && String(item.number) === q.replace(/\D/g, '');
        if (inTitle || section || numberMatch) results.push({ c, item, section });
      });
    });
    if (shelf) shelf.hidden = true;
    box.hidden = false;
    const locked = !!lockReason();
    box.innerHTML = results.length ? `
      <p class="lib-results__count">Найдено: ${results.length} ${plural(results.length, 'билет', 'билета', 'билетов')}</p>
      <ul class="lib-results__list">
        ${results.slice(0, 40).map(({ c, item, section }) => `
          <li>
            <a class="lib-result" href="#t/${encodeURIComponent(item.id)}" style="${bookStyle(c)}">
              <span class="lib-result__num">${item.number}</span>
              <span class="lib-result__body">
                <b>${esc(item.title)}</b>
                <small>${esc(c.disciplineTitle)}${section ? ` · раздел ${esc(section.id || '')} «${esc(section.title || section.title_raw)}»` : ''}</small>
              </span>
              <span class="lib-result__state">${locked ? ICONS.lock : ICONS.chevron}</span>
            </a>
          </li>`).join('')}
      </ul>` : `
      <div class="lib-empty lib-empty--small">
        <b>Ничего не нашлось</b>
        <p>Попробуй другое слово или номер билета.</p>
      </div>`;
  }

  /* ---------------- Сборник ---------------- */
  function renderCollection(collectionId) {
    const c = state.collectionsById.get(collectionId);
    const box = $('libCollection');
    if (!box) return;
    if (!c || !state.itemsByCollection.has(c.id)) {
      box.innerHTML = `
        <div class="lib-empty">
          <b>Сборник не найден</b>
          <p>Возможно, его убрали или переименовали.</p>
          <a class="btn btn--outline" href="#" data-go-shelf>Ко всем сборникам</a>
        </div>`;
      return;
    }
    const items = state.itemsByCollection.get(c.id);
    const words = items.reduce((sum, i) => sum + (i.wordCount || 0), 0) || c.wordCount;
    const parts = Array.from(new Set(items.map(i => i.part).filter(Boolean)));
    if (state.part !== 'all' && !parts.includes(state.part)) state.part = 'all';
    const progress = collectionProgress(c.id);
    const locked = lockReason();
    const lastId = lastOpened(c.id);
    const last = lastId && state.itemsById.get(lastId);
    const label = itemLabel(c);
    const cta = locked
      ? `<button type="button" class="btn btn--primary" data-unlock>${ICONS.lock}Открыть доступ</button>`
      : last
        ? `<a class="btn btn--primary" href="#t/${encodeURIComponent(last.id)}">Продолжить: ${label.toLowerCase()} ${last.number}</a>`
        : `<a class="btn btn--primary" href="#t/${encodeURIComponent(items[0].id)}">Начать с ${label === 'Билет' ? 'билета' : 'темы'} ${items[0].number}</a>`;

    box.innerHTML = `
      <header class="lib-col" style="${bookStyle(c)}">
        <div class="lib-col__cover" aria-hidden="true">
          <span class="lib-book__spine"></span>
          <span class="lib-book__kind">${esc(kindTitle(c))}</span>
          <b class="lib-book__name">${esc(softHyphens(c.disciplineTitle))}</b>
          <span class="lib-book__emblem">§</span>
        </div>
        <div class="lib-col__info">
          <span class="lib-eyebrow lib-col__eyebrow">${esc(c.disciplineTitle)}</span>
          <h1 class="lib-col__title">${esc(c.title)}</h1>
          ${c.description ? `<p class="lib-col__desc">${esc(c.description)}</p>` : ''}
          <div class="lib-col__chips">
            <span>${items.length} ${plural(items.length, label.toLowerCase(), label === 'Билет' ? 'билета' : 'темы', label === 'Билет' ? 'билетов' : 'тем')}</span>
            ${parts.length ? `<span>${esc(parts.join(' и '))}</span>` : ''}
            <span>${ICONS.clock}≈ ${readingTime(words)} чтения</span>
            ${c.author ? `<span>Автор: ${esc(c.author)}</span>` : ''}
            ${c.actualized
              ? `<span class="lib-col__chip--ok">${ICONS.check}Нормы актуальны</span>`
              : '<span class="lib-col__chip--warn">Нормы сверяются с актуальной редакцией</span>'}
          </div>
          <div class="lib-col__progress">
            <div class="lib-book__progress"><span style="--p:${progress.percent}%"></span></div>
            <small>${progress.done ? `Прочитано ${progress.done} из ${progress.total}` : 'Ещё ничего не прочитано'}</small>
          </div>
          <div class="lib-col__actions">${cta}</div>
        </div>
      </header>

      <div class="lib-col-tools">
        ${parts.length > 1 ? `
          <div class="lib-parts" role="tablist" aria-label="Части">
            <button type="button" class="lib-part ${state.part === 'all' ? 'is-active' : ''}" data-part="all">Все <i>${items.length}</i></button>
            ${parts.map(p => `<button type="button" class="lib-part ${state.part === p ? 'is-active' : ''}" data-part="${esc(p)}">${esc(p)} <i>${items.filter(i => i.part === p).length}</i></button>`).join('')}
          </div>` : '<span></span>'}
        <label class="lib-search lib-search--sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.35-4.35"/></svg>
          <span class="visually-hidden">Поиск в сборнике</span>
          <input type="search" id="libColSearch" placeholder="Найти в сборнике…" autocomplete="off" value="${esc(state.colQuery)}" />
        </label>
      </div>

      <div id="libTickets"></div>`;
    fitCoverNames(box);
    renderTickets(c, true);
  }

  function renderTickets(c, animate) {
    const box = $('libTickets');
    if (!box) return;
    const items = state.itemsByCollection.get(c.id) || [];
    const q = normalize(state.colQuery.trim());
    const read = readMap();
    const locked = !!lockReason();
    const lastId = lastOpened(c.id);
    const shown = items.filter(i => (state.part === 'all' || i.part === state.part)
      && (!q || normalize(i.title).includes(q) || String(i.number) === q
        || i.sections.some(s => normalize(s.title || s.title_raw).includes(q))));
    if (!shown.length) {
      box.innerHTML = '<div class="lib-empty lib-empty--small"><b>Ничего не нашлось</b><p>Попробуй другое слово или номер.</p></div>';
      return;
    }
    let html = '';
    let currentPart = null;
    const groupByPart = state.part === 'all' && !q && shown.some(i => i.part);
    shown.forEach((item, index) => {
      if (groupByPart && item.part !== currentPart) {
        if (index) html += '</ol>';
        currentPart = item.part;
        html += `<h2 class="lib-part-title">${esc(item.part || 'Без части')}</h2><ol class="lib-tickets">`;
      } else if (!index) {
        html += '<ol class="lib-tickets">';
      }
      const sectionsLine = item.sections.slice(0, 4).map(s => s.title || s.title_raw).filter(Boolean).join(' · ');
      const isRead = !!read[item.id];
      const isLast = item.id === lastId;
      html += `
        <li>
          <a class="lib-ticket ${isRead ? 'is-read' : ''} ${isLast ? 'is-last' : ''}" href="#t/${encodeURIComponent(item.id)}">
            <span class="lib-ticket__num">${item.number}</span>
            <span class="lib-ticket__body">
              <b>${esc(item.title)}</b>
              ${sectionsLine ? `<small class="lib-ticket__sections">${esc(sectionsLine)}</small>` : ''}
              <small class="lib-ticket__meta">
                ${item.sections.length ? `${item.sections.length} ${plural(item.sections.length, 'раздел', 'раздела', 'разделов')} · ` : ''}${readingTime(item.wordCount)}
                ${isLast && !isRead ? '<em>Ты остановился здесь</em>' : ''}
              </small>
            </span>
            <span class="lib-ticket__state" aria-label="${locked ? 'Закрыто' : isRead ? 'Прочитано' : 'Открыть'}">${locked ? ICONS.lock : isRead ? ICONS.check : ICONS.chevron}</span>
          </a>
        </li>`;
    });
    html += '</ol>';
    box.innerHTML = html;
    if (animate && window.LexPrepMotion) LexPrepMotion.stagger(box, '.lib-ticket', 60);
  }

  /* ---------------- Замок ---------------- */
  function openModal(html) {
    const modal = $('libModal');
    $('libModalBody').innerHTML = html;
    modal.hidden = false;
    document.body.classList.add('lib-modal-open');
    requestAnimationFrame(() => modal.classList.add('is-open'));
    const focusable = modal.querySelector('.lib-modal__card .btn, .lib-modal__close');
    if (focusable) focusable.focus({ preventScroll: true });
  }

  function closeModal() {
    const modal = $('libModal');
    if (!modal || modal.hidden) return;
    modal.classList.remove('is-open');
    document.body.classList.remove('lib-modal-open');
    setTimeout(() => { modal.hidden = true; }, 220);
  }

  function showLock(reason, item) {
    const c = item && state.collectionsById.get(item.collectionId);
    const title = item ? `${itemLabel(c)} ${item.number}. ${item.title}` : '';
    const copy = {
      guest: {
        head: 'Войди, чтобы читать',
        text: 'Библиотека доступна на тарифах «Про» и «Максимум». Войди в аккаунт или зарегистрируйся.',
        actions: '<a href="auth.html#login" class="btn btn--primary btn--block">Войти</a><a href="auth.html#register" class="btn btn--outline btn--block">Создать аккаунт</a>'
      },
      plan: {
        head: 'Открой библиотеку с «Про»',
        text: 'Все сборники билетов по дисциплинам — на тарифах «Про» и «Максимум».',
        actions: '<a href="profile.html#subscription" class="btn btn--primary btn--block">Оформить «Про»</a><a href="index.html#pricing" class="btn btn--outline btn--block">Сравнить тарифы</a>'
      },
      coins: {
        head: 'Нужна оформленная подписка',
        text: 'Тариф, полученный за монеты, открывает тренажёр, но не библиотеку. Сборники доступны с оплаченной подпиской «Про» или «Максимум».',
        actions: '<a href="profile.html#subscription" class="btn btn--primary btn--block">Оформить подписку</a>'
      }
    }[reason] || { head: 'Доступ закрыт', text: '', actions: '' };
    openModal(`
      <div class="lib-lock" ${c ? `style="${bookStyle(c)}"` : ''}>
        <span class="lib-lock__icon">${ICONS.lock}</span>
        <h2 id="libModalTitle">${copy.head}</h2>
        ${title ? `<p class="lib-lock__item">${esc(title)}</p>` : ''}
        <p class="lib-lock__text">${copy.text}</p>
        <ul class="lib-lock__list">
          <li>${ICONS.check}Все сборники билетов по дисциплинам</li>
          <li>${ICONS.check}Врезки с нормами, схемы и сноски</li>
          <li>${ICONS.check}Оглавление, закладка и отметки прочитанного</li>
        </ul>
        <div class="lib-lock__actions">${copy.actions}</div>
      </div>`);
  }

  /* ---------------- Очистка HTML билета ---------------- */
  const ALLOWED_TAGS = new Set(['P', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUB', 'SUP', 'BR', 'HR',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD',
    'COLGROUP', 'COL', 'BLOCKQUOTE', 'IMG', 'A', 'CODE', 'PRE', 'FIGURE', 'FIGCAPTION', 'MARK', 'SMALL', 'DL', 'DT', 'DD']);
  const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA',
    'SELECT', 'LINK', 'META', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'VIDEO', 'AUDIO', 'CANVAS', 'BASE', 'FRAME', 'FRAMESET']);

  function cleanStyle(el, style) {
    const out = [];
    const indent = /margin-left:\s*calc\(\s*([\d.]+)pt\s*\+\s*[\d.]+em\s*\)/i.exec(style);
    const plain = !indent && /margin-left:\s*([\d.]+)pt/i.exec(style);
    if (indent) {
      out.push(`--in:${Math.min(200, parseFloat(indent[1]) || 0)}`);
      el.classList.add('in-li');
    } else if (plain) {
      out.push(`--in:${Math.min(200, parseFloat(plain[1]) || 0)}`);
      el.classList.add('in-p');
    }
    const width = /(?:^|;)\s*width:\s*([\d.]+)%/i.exec(style);
    if (width && el.tagName === 'COL') out.push(`width:${Math.min(100, parseFloat(width[1]))}%`);
    return out.join(';');
  }

  function sanitizeInto(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    const walk = (node) => {
      Array.from(node.children).forEach(el => {
        const tag = el.tagName;
        if (DROP_TAGS.has(tag)) {
          el.remove();
          return;
        }
        if (!ALLOWED_TAGS.has(tag)) {
          walk(el);
          el.replaceWith(...Array.from(el.childNodes));
          return;
        }
        const attrs = {};
        Array.from(el.attributes).forEach(a => { attrs[a.name.toLowerCase()] = a.value; });
        Array.from(el.attributes).forEach(a => el.removeAttribute(a.name));
        if (attrs.class) {
          const classes = attrs.class.split(/\s+/).filter(cls => /^[a-z][a-z0-9-]{0,30}$/i.test(cls));
          if (classes.length) el.className = classes.join(' ');
        }
        if (attrs.style) {
          const style = cleanStyle(el, attrs.style);
          if (style) el.setAttribute('style', style);
        }
        if ((tag === 'TD' || tag === 'TH') && /^\d{1,2}$/.test(attrs.colspan || '')) el.setAttribute('colspan', attrs.colspan);
        if ((tag === 'TD' || tag === 'TH') && /^\d{1,2}$/.test(attrs.rowspan || '')) el.setAttribute('rowspan', attrs.rowspan);
        if (tag === 'OL' && /^\d{1,4}$/.test(attrs.start || '')) el.setAttribute('start', attrs.start);
        if (tag === 'IMG') {
          el.setAttribute('data-src', attrs.src || '');
          if (attrs.alt) el.setAttribute('alt', attrs.alt);
        }
        if (tag === 'A') {
          const href = attrs.href || '';
          if (/^#[\w-]+$/.test(href)) {
            el.setAttribute('href', href);
          } else if (/^https?:\/\//i.test(href)) {
            el.setAttribute('href', href);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer nofollow');
          }
        }
        walk(el);
      });
    };
    walk(root);
    return document.importNode(root, true);
  }

  // Markdown-вариант (content_md): GitHub-alerts [!NOTE]/[!TIP]/[!WARNING]
  // становятся теми же врезками, что и в HTML-варианте, [^n] — сносками.
  function markdownToHtml(md) {
    if (typeof marked === 'undefined') return `<p>${esc(md)}</p>`;
    const prepared = String(md || '').replace(/\[\^(\d+)\](?!:)/g, '<sup class="fn-ref">$1</sup>');
    return marked.parse(prepared);
  }

  function upgradeAlerts(root) {
    const map = { NOTE: 'law', TIP: 'note', IMPORTANT: 'note', WARNING: 'warn', CAUTION: 'warn' };
    root.querySelectorAll('blockquote').forEach(q => {
      const first = q.querySelector('p');
      const m = first && /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(first.textContent);
      if (!m) return;
      const div = document.createElement('div');
      div.className = `callout ${map[m[1].toUpperCase()]}`;
      first.innerHTML = first.innerHTML.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br\s*\/?>)?/i, '');
      if (!first.textContent.trim() && !first.querySelector('img')) first.remove();
      div.append(...Array.from(q.childNodes));
      q.replaceWith(div);
    });
  }

  function base64ToBlobUrl(data, mime) {
    try {
      const bin = atob(String(data).replace(/^data:[^,]*,/, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'image/png' }));
      state.blobUrls.push(url);
      return url;
    } catch (e) {
      return null;
    }
  }

  function releaseBlobs() {
    state.blobUrls.forEach(url => URL.revokeObjectURL(url));
    state.blobUrls = [];
  }

  function baseName(path) {
    return String(path || '').split(/[\\/]/).pop().toLowerCase();
  }

  /* ---------------- Читалка ---------------- */
  function watermarkImage(text) {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const fill = dark ? '#ffffff' : '#1c2340';
    const opacity = dark ? 0.065 : 0.07;
    const safe = text.replace(/[<>&'"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240"><g transform="rotate(-24 210 120)" font-family="Manrope, Arial, sans-serif" font-size="14" font-weight="700" fill="${fill}" fill-opacity="${opacity}"><text x="20" y="96">${safe}</text><text x="120" y="196">${safe}</text></g></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }

  function applyWatermark() {
    const el = $('libWatermark');
    if (!el) return;
    const user = state.user || {};
    const idTail = user.id ? String(user.id).slice(-6).toUpperCase() : '';
    const date = new Date().toLocaleDateString('ru-RU');
    const text = [user.email || user.name || 'LexPrep', idTail && `ID ${idTail}`, date, 'LexPrep'].filter(Boolean).join(' · ');
    el.style.backgroundImage = watermarkImage(text);
  }

  function applyFont() {
    let step = parseInt(localStorage.getItem(FONT_KEY) || '1', 10);
    if (!(step >= 0 && step < FONT_STEPS.length)) step = 1;
    const paper = $('libPaper');
    if (paper) paper.style.setProperty('--lib-fs', `${FONT_STEPS[step]}px`);
    document.querySelectorAll('[data-font]').forEach(btn => {
      const dir = Number(btn.dataset.font);
      btn.disabled = dir < 0 ? step === 0 : step === FONT_STEPS.length - 1;
    });
    return step;
  }

  function changeFont(dir) {
    let step = parseInt(localStorage.getItem(FONT_KEY) || '1', 10);
    if (!(step >= 0 && step < FONT_STEPS.length)) step = 1;
    step = Math.max(0, Math.min(FONT_STEPS.length - 1, step + dir));
    try { localStorage.setItem(FONT_KEY, String(step)); } catch (e) { /* не критично */ }
    applyFont();
  }

  function neighbours(item) {
    const list = state.itemsByCollection.get(item.collectionId) || [];
    const index = list.findIndex(i => i.id === item.id);
    return { prev: index > 0 ? list[index - 1] : null, next: index >= 0 && index < list.length - 1 ? list[index + 1] : null, index, total: list.length };
  }

  function readerSkeleton() {
    return `
      <div class="lib-paper__loading">
        <span class="lib-line lib-line--kicker"></span>
        <span class="lib-line lib-line--title"></span>
        <span class="lib-line"></span><span class="lib-line"></span><span class="lib-line lib-line--short"></span>
        <span class="lib-line"></span><span class="lib-line"></span><span class="lib-line lib-line--short"></span>
      </div>`;
  }

  function buildContent(data, item) {
    const c = state.collectionsById.get(item.collectionId);
    const html = data.contentHtml || markdownToHtml(data.contentMd);
    const content = sanitizeInto(html);
    content.className = 'lib-content';
    if (!data.contentHtml) upgradeAlerts(content);

    // Схемы: <img src> сопоставляем с приложенными к билету картинками по
    // имени файла; картинка превращается в blob:-адрес, который живёт
    // только пока открыт этот билет.
    const assets = new Map((data.assets || []).map(a => [baseName(a.path), a]));
    content.querySelectorAll('img').forEach(img => {
      const asset = assets.get(baseName(img.getAttribute('data-src')));
      const url = asset && base64ToBlobUrl(asset.data, asset.mime);
      if (!url) {
        img.remove();
        return;
      }
      const figure = document.createElement('figure');
      figure.className = 'lib-figure';
      figure.setAttribute('data-zoom', url);
      figure.setAttribute('tabindex', '0');
      figure.setAttribute('role', 'button');
      figure.setAttribute('aria-label', 'Увеличить схему');
      const pic = document.createElement('img');
      pic.src = url;
      pic.alt = img.getAttribute('alt') || 'Схема';
      pic.draggable = false;
      pic.loading = 'lazy';
      figure.append(pic);
      figure.insertAdjacentHTML('beforeend', `<span class="lib-figure__zoom" aria-hidden="true">${ICONS.zoom}</span>`);
      const holder = img.closest('p, span');
      if (holder && holder !== content && holder.textContent.trim() === '' && holder.querySelectorAll('img').length === 1) holder.replaceWith(figure);
      else img.replaceWith(figure);
    });

    content.querySelectorAll('table').forEach(table => {
      const wrap = document.createElement('div');
      wrap.className = 'lib-table';
      table.replaceWith(wrap);
      wrap.append(table);
    });

    content.querySelectorAll('.callout').forEach(box => {
      const kind = ['law', 'note', 'warn'].find(k => box.classList.contains(k)) || 'note';
      const label = document.createElement('span');
      label.className = 'callout__label';
      label.textContent = CALLOUT_LABELS[kind];
      box.prepend(label);
    });

    // Заголовки разделов: «22.1. ПОНЯТИЕ …» → «22.1. Понятие …» из
    // оглавления (там нормальный регистр) + якоря для панели разделов.
    const sections = data.sections && data.sections.length ? data.sections : item.sections;
    const toc = [];
    content.querySelectorAll('h2').forEach((h, i) => {
      const m = /^\s*(\d+(?:\.\d+)*)\.?\s*/.exec(h.textContent);
      const section = m && sections.find(s => String(s.id) === m[1]);
      if (section && section.title) h.textContent = `${section.id}. ${section.title}`;
      h.id = `lib-sec-${i + 1}`;
      toc.push({ id: h.id, num: section ? section.id : (m ? m[1] : ''), title: section && section.title ? section.title : h.textContent.replace(/^\s*\d+(?:\.\d+)*\.?\s*/, '') });
    });

    const { prev, next, index, total } = neighbours(item);
    const label = itemLabel(c);
    const read = readMap();
    const frag = document.createDocumentFragment();

    const head = document.createElement('header');
    head.className = 'lib-paper__head';
    head.innerHTML = `
      <div class="lib-paper__kicker">
        <span class="lib-paper__dot"></span>${esc(c ? c.disciplineTitle : '')}${item.part ? ` · ${esc(item.part)}` : ''}
      </div>
      <div class="lib-paper__num">${label} ${item.number}${total ? `<small>из ${total}</small>` : ''}</div>
      <h1 class="lib-paper__title">${esc(item.title)}</h1>
      <div class="lib-paper__meta">
        <span>${ICONS.clock}${readingTime(item.wordCount || data.wordCount)} чтения</span>
        ${toc.length ? `<span>${ICONS.list}${toc.length} ${plural(toc.length, 'раздел', 'раздела', 'разделов')}</span>` : ''}
        <span class="lib-paper__protected">${ICONS.shield}Только для чтения на сайте</span>
      </div>
      ${c && !c.actualized ? `<div class="lib-paper__notice">${ICONS.alert}<span>Нормы и практика в этом сборнике сейчас сверяются с актуальной редакцией законов.</span></div>` : ''}`;
    frag.append(head);
    frag.append(content);

    if (data.footnotes && data.footnotes.length) {
      // Собираем строкой и чистим через DOMParser (инертный документ) —
      // не через innerHTML живого элемента, где <img onerror> успел бы
      // сработать до очистки.
      const list = data.footnotes.map(f => {
        const body = typeof marked !== 'undefined' && marked.parseInline ? marked.parseInline(String(f.md || f.text || '')) : esc(f.md || f.text || '');
        return `<li>${body}</li>`;
      }).join('');
      const clean = sanitizeInto(`<ol>${list}</ol>`);
      const notes = document.createElement('section');
      notes.className = 'lib-footnotes';
      notes.innerHTML = '<h3>Сноски</h3>';
      const ol = clean.querySelector('ol');
      if (ol) {
        const first = Number(data.footnotes[0].n);
        if (first > 1) ol.setAttribute('start', String(first));
        notes.append(ol);
      }
      frag.append(notes);
    }

    const foot = document.createElement('footer');
    foot.className = 'lib-paper__foot';
    foot.innerHTML = `
      <div class="lib-paper__done ${read[item.id] ? 'is-done' : ''}" id="libDoneMark">
        <span class="lib-paper__done-icon">${ICONS.check}</span>
        <span>${read[item.id] ? 'Билет прочитан' : 'Дочитай до конца — билет отметится прочитанным'}</span>
      </div>
      <nav class="lib-pager" aria-label="Соседние билеты">
        ${prev ? `<a class="lib-pager__link lib-pager__link--prev" href="#t/${encodeURIComponent(prev.id)}"><small>${ICONS.prev}Предыдущий</small><b>${prev.number}. ${esc(prev.title)}</b></a>` : '<span></span>'}
        ${next ? `<a class="lib-pager__link lib-pager__link--next" href="#t/${encodeURIComponent(next.id)}"><small>Следующий${ICONS.chevron}</small><b>${next.number}. ${esc(next.title)}</b></a>` : '<span></span>'}
      </nav>
      <p class="lib-paper__index">${label} ${index + 1} из ${total}</p>`;
    frag.append(foot);
    return { frag, toc };
  }

  function renderToc(toc) {
    const list = $('libTocList');
    const toggle = $('libTocToggle');
    const aside = $('libToc');
    if (!list) return;
    list.innerHTML = toc.map(t => `
      <li><a href="#${t.id}" data-toc="${t.id}"><span>${esc(t.num)}</span>${esc(t.title)}</a></li>`).join('');
    const has = toc.length > 1;
    if (toggle) toggle.hidden = !has;
    if (aside) aside.classList.toggle('is-empty', !has);
    document.querySelector('.lib-reader').classList.toggle('has-toc', has);
  }

  let spyObserver = null;
  let endObserver = null;
  function watchReading(item) {
    if (spyObserver) spyObserver.disconnect();
    if (endObserver) endObserver.disconnect();
    const headings = Array.from(document.querySelectorAll('#libPaperBody .lib-content h2'));
    if (headings.length && 'IntersectionObserver' in window) {
      spyObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          document.querySelectorAll('#libTocList a').forEach(a => a.classList.toggle('is-active', a.dataset.toc === entry.target.id));
        });
      }, { rootMargin: '-150px 0px -65% 0px' });
      headings.forEach(h => spyObserver.observe(h));
    }
    const mark = $('libDoneMark');
    if (mark && 'IntersectionObserver' in window) {
      endObserver = new IntersectionObserver(entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        if (markRead(item.id)) {
          mark.classList.add('is-done');
          mark.querySelector('span:last-child').textContent = 'Билет прочитан';
          toast('Билет отмечен как прочитанный');
        }
        endObserver.disconnect();
      }, { threshold: 0.6 });
      endObserver.observe(mark);
    }
  }

  function updateProgress() {
    const bar = $('libProgressBar');
    const paper = $('libPaper');
    if (!bar || !paper || $('libReaderView').hidden) return;
    const rect = paper.getBoundingClientRect();
    const total = rect.height - window.innerHeight * 0.6;
    const ratio = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
    bar.style.transform = `scaleX(${ratio})`;
  }

  async function openReader(itemId) {
    const item = state.itemsById.get(itemId);
    const body = $('libPaperBody');
    const c = item && state.collectionsById.get(item.collectionId);
    if (!item || !c) {
      showView('collection');
      $('libCollection').innerHTML = `
        <div class="lib-empty">
          <b>Билет не найден</b>
          <p>Возможно, его убрали из сборника.</p>
          <a class="btn btn--outline" href="#" data-go-shelf>Ко всем сборникам</a>
        </div>`;
      return;
    }
    const reason = lockReason();
    if (reason) {
      // Без доступа остаёмся на оглавлении сборника и показываем замок.
      history.replaceState(null, '', `#c/${encodeURIComponent(c.id)}`);
      route();
      showLock(reason, item);
      return;
    }

    showView('reader');
    const token = ++state.readerToken;
    $('libReaderCollection').textContent = c.title;
    $('libReaderHeading').textContent = `${itemLabel(c)} ${item.number}. ${item.title}`;
    $('libReaderBack').setAttribute('href', `#c/${encodeURIComponent(c.id)}`);
    const [bookColor, bookColor2] = colorsFor(c);
    $('libPaper').style.setProperty('--book', bookColor);
    $('libPaper').style.setProperty('--book-2', bookColor2);
    applyFont();
    applyWatermark();
    releaseBlobs();
    renderToc([]);
    body.innerHTML = readerSkeleton();
    window.scrollTo(0, 0);
    updateProgress();

    let data = state.cache.get(itemId);
    if (!data) {
      try {
        data = await LexPrepApi.readLibraryItem(itemId);
        // В памяти держим только несколько последних билетов.
        state.cache.set(itemId, data);
        if (state.cache.size > 6) state.cache.delete(state.cache.keys().next().value);
        // Счётчик «открыто сегодня» на полке — со свежими данными сервера.
        LexPrepApi.getLibraryStatus().then(s => { state.status = s; }).catch(() => {});
      } catch (err) {
        if (token !== state.readerToken) return;
        if (err.status === 401) err.code = 'library_auth_required';
        if (err.code === 'library_plan_required' || err.code === 'library_auth_required') {
          if (err.code === 'library_auth_required') state.user = null;
          if (state.status) state.status.hasAccess = false;
          history.replaceState(null, '', `#c/${encodeURIComponent(c.id)}`);
          route();
          showLock(lockReason() || 'plan', item);
          return;
        }
        body.innerHTML = `
          <div class="lib-empty lib-empty--reader">
            <b>${err.code === 'library_daily_limit' ? 'Лимит на сегодня исчерпан' : 'Не удалось открыть билет'}</b>
            <p>${esc(err.code === 'library_daily_limit'
              ? 'За сутки можно открыть ограниченное число разных билетов — так мы защищаем сборники от автоматического копирования. Уже открытые сегодня билеты читаются без ограничений.'
              : err.message || 'Проверь интернет и попробуй ещё раз.')}</p>
            ${err.code === 'library_daily_limit' ? '' : '<button type="button" class="btn btn--primary" data-retry>Попробовать ещё раз</button>'}
          </div>`;
        return;
      }
    }
    if (token !== state.readerToken) return;

    const { frag, toc } = buildContent(data, item);
    body.innerHTML = '';
    body.append(frag);
    renderToc(toc);
    rememberLast(c.id, item.id);
    watchReading(item);
    updateProgress();
    if (window.LexPrepMotion && !LexPrepMotion.reduced()) {
      body.classList.remove('is-entering');
      void body.offsetWidth;
      body.classList.add('is-entering');
    }
  }

  function setTocOpen(open) {
    const aside = $('libToc');
    const backdrop = $('libTocBackdrop');
    const toggle = $('libTocToggle');
    if (!aside) return;
    aside.classList.toggle('is-open', open);
    if (backdrop) backdrop.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('lib-toc-open', open);
  }

  /* ---------------- Защита от копирования ---------------- */
  let lastWarn = 0;
  function warnProtected(message) {
    const now = Date.now();
    if (now - lastWarn < 1500) return;
    lastWarn = now;
    toast(message || 'Материалы библиотеки можно только читать на сайте');
  }

  function readerActive() {
    const view = $('libReaderView');
    return view && !view.hidden;
  }

  function initProtection() {
    const paper = $('libPaper');
    const lightbox = $('libLightbox');
    [paper, lightbox].forEach(el => {
      if (!el) return;
      ['copy', 'cut'].forEach(type => el.addEventListener(type, (e) => {
        e.preventDefault();
        if (e.clipboardData) e.clipboardData.setData('text/plain', '');
        warnProtected('Копирование билетов недоступно');
      }));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        warnProtected();
      });
      el.addEventListener('dragstart', (e) => e.preventDefault());
      el.addEventListener('selectstart', (e) => e.preventDefault());
    });

    document.addEventListener('copy', (e) => {
      if (!readerActive()) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && paper && sel.rangeCount && paper.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        e.preventDefault();
        warnProtected('Копирование билетов недоступно');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!readerActive() && (!lightbox || lightbox.hidden)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = (e.key || '').toLowerCase();
      const inField = e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (mod && ['s', 'p', 'ы', 'з'].includes(key)) {
        e.preventDefault();
        warnProtected(key === 's' || key === 'ы' ? 'Сохранить билет нельзя — только читать на сайте' : 'Печать билетов недоступна');
        return;
      }
      if (mod && !inField && ['c', 'x', 'a', 'с', 'ч', 'ф'].includes(key)) {
        e.preventDefault();
        warnProtected('Копирование билетов недоступно');
      }
    });

    window.addEventListener('beforeprint', () => {
      if (readerActive()) warnProtected('Печать билетов недоступна');
    });
  }

  /* ---------------- Схемы крупно ---------------- */
  function openLightbox(url) {
    const box = $('libLightbox');
    const img = $('libLightboxImg');
    if (!box || !img) return;
    img.style.backgroundImage = `url("${url}")`;
    box.hidden = false;
    document.body.classList.add('lib-modal-open');
    requestAnimationFrame(() => box.classList.add('is-open'));
  }

  function closeLightbox() {
    const box = $('libLightbox');
    if (!box || box.hidden) return;
    box.classList.remove('is-open');
    document.body.classList.remove('lib-modal-open');
    setTimeout(() => {
      box.hidden = true;
      $('libLightboxImg').style.backgroundImage = '';
    }, 200);
  }

  /* ---------------- Маршруты ---------------- */
  function showView(name) {
    ['shelf', 'collection', 'reader'].forEach(v => {
      const el = $(`lib${v.charAt(0).toUpperCase()}${v.slice(1)}View`);
      if (el) el.hidden = v !== name;
    });
    document.body.classList.toggle('lib-reading', name === 'reader');
    if (name !== 'reader') {
      releaseBlobs();
      setTocOpen(false);
      if (spyObserver) spyObserver.disconnect();
      if (endObserver) endObserver.disconnect();
      state.readerToken++;
      const body = $('libPaperBody');
      if (body) body.innerHTML = '';
    }
  }

  let lastRoute = null;
  function route() {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    const [kind, ...rest] = hash.split('/');
    const id = rest.join('/');
    if (kind === 't' && id) {
      if (lastRoute === `t/${id}`) return;
      lastRoute = `t/${id}`;
      openReader(id);
      return;
    }
    if (kind === 'c' && id) {
      const changed = lastRoute !== `c/${id}`;
      if (changed) {
        state.colQuery = '';
        const prevRoute = lastRoute || '';
        const cameFromTicket = prevRoute.startsWith('t/') && state.itemsById.get(prevRoute.slice(2)) && state.itemsById.get(prevRoute.slice(2)).collectionId === id;
        if (!cameFromTicket) state.part = 'all';
      }
      lastRoute = `c/${id}`;
      showView('collection');
      renderCollection(id);
      if (changed) window.scrollTo(0, 0);
      return;
    }
    const cameBack = lastRoute !== null && lastRoute !== 'shelf';
    lastRoute = 'shelf';
    showView('shelf');
    renderShelf(!cameBack);
    if (cameBack) window.scrollTo(0, 0);
  }

  function go(hash) {
    if (window.location.hash === hash) route();
    else window.location.hash = hash;
  }

  /* ---------------- События ---------------- */
  function bindEvents() {
    window.addEventListener('hashchange', route);

    document.addEventListener('click', (e) => {
      const toShelf = e.target.closest('[data-go-shelf]');
      if (toShelf) {
        e.preventDefault();
        history.pushState(null, '', window.location.pathname + window.location.search);
        route();
        return;
      }
      if (e.target.closest('[data-reload]')) {
        window.location.reload();
        return;
      }
      if (e.target.closest('[data-retry]')) {
        lastRoute = null;
        route();
        return;
      }
      if (e.target.closest('[data-unlock]')) {
        showLock(lockReason() || 'plan');
        return;
      }
      if (e.target.closest('[data-close-modal]')) {
        closeModal();
        return;
      }
      if (e.target.closest('[data-close-lightbox]')) {
        closeLightbox();
        return;
      }
      const zoom = e.target.closest('[data-zoom]');
      if (zoom) {
        openLightbox(zoom.getAttribute('data-zoom'));
        return;
      }
      const ticketLink = e.target.closest('a[href^="#t/"]');
      if (ticketLink) {
        const id = decodeURIComponent(ticketLink.getAttribute('href').slice(3));
        const reason = lockReason();
        if (reason) {
          e.preventDefault();
          showLock(reason, state.itemsById.get(id));
        }
        return;
      }
      const tocLink = e.target.closest('[data-toc]');
      if (tocLink) {
        e.preventDefault();
        const target = document.getElementById(tocLink.dataset.toc);
        setTocOpen(false);
        if (target) target.scrollIntoView({ behavior: window.LexPrepMotion && LexPrepMotion.reduced() ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      const chip = e.target.closest('[data-filter]');
      if (chip && $('libFilter').contains(chip)) {
        state.filter = chip.dataset.filter;
        renderShelf();
        return;
      }
      const part = e.target.closest('[data-part]');
      if (part) {
        state.part = part.dataset.part;
        document.querySelectorAll('[data-part]').forEach(b => b.classList.toggle('is-active', b === part));
        const c = state.collectionsById.get((lastRoute || '').slice(2));
        if (c) renderTickets(c, true);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeLightbox();
        closeModal();
        setTocOpen(false);
      }
      const zoom = e.target.closest && e.target.closest('[data-zoom]');
      if (zoom && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openLightbox(zoom.getAttribute('data-zoom'));
      }
    });

    const search = $('libSearch');
    if (search) {
      search.addEventListener('input', () => {
        state.query = search.value;
        renderSearch();
      });
    }

    document.addEventListener('input', (e) => {
      if (e.target.id !== 'libColSearch') return;
      state.colQuery = e.target.value;
      const c = state.collectionsById.get((lastRoute || '').slice(2));
      if (c) renderTickets(c, false);
    });

    $('libTocToggle').addEventListener('click', () => setTocOpen(!$('libToc').classList.contains('is-open')));
    $('libTocClose').addEventListener('click', () => setTocOpen(false));
    $('libTocBackdrop').addEventListener('click', () => setTocOpen(false));
    document.querySelectorAll('[data-font]').forEach(btn => btn.addEventListener('click', () => changeFont(Number(btn.dataset.font))));

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateProgress();
      });
    }, { passive: true });

    // Профиль досверился с сервером (тариф мог смениться) — обновляем доступ.
    window.addEventListener('lexprep:user', (e) => {
      const before = !!lockReason();
      state.user = e.detail || null;
      if (!state.loaded) return;
      if (before !== !!lockReason() && typeof LexPrepApi !== 'undefined') {
        LexPrepApi.getLibraryStatus().then(s => { state.status = s; }).catch(() => {}).finally(() => {
          if (!readerActive()) { lastRoute = null; route(); }
        });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    state.user = currentUser();
    const params = new URLSearchParams(window.location.search);
    if (params.get('d')) state.filter = params.get('d');
    bindEvents();
    initProtection();
    applyFont();
    await loadCatalog();
    route();
    // Шрифт Manrope догружается асинхронно — после него ширина слов другая.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitCoverNames());
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitCoverNames(), 150);
    });
  });
})();
