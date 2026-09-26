/* ==========================================================================
SCRIPT.JS — интерактивность: меню, аккордеон, демо-навигация, hero-анимация,
форма обратной связи
========================================================================== */
initHeroTitle();

document.addEventListener('DOMContentLoaded', () => {
  initHeaderScroll();
  initMobileNav();
  initSmoothAnchors();
  initAccordion();
  initHeroStudy();
  initHeroBackground();
  initStatCounters();
  initRoadmap();
  initFeatureTabs();
  initFeedbackForm();
  initRevealOnScroll();
  initAuthState();
  initOnlineCounter();
  initLevelUpToast();
  initCatalogStats();
});

/* ---------------- Живые цифры "N отраслей права" / "N тем в базе" ----------------
   Раньше были захардкожены в HTML (index.html, auth.html) и расходились с
   реальным каталогом при каждом импорте новой дисциплины. Теперь считаем
   напрямую агрегатным select'ом в disciplines/topics — раз только для
   счётчика, не тянем сюда весь content-loader.js с конспектами. Если
   запрос не выполнился (нет сети, сработал таймаут и т.п.) — просто
   оставляем статичные числа, зашитые в HTML, как разумный фолбэк. */
function initCatalogStats() {
  const disciplinesEl = document.getElementById('statDisciplines');
  const topicsEl = document.getElementById('statTopics');
  if (!disciplinesEl && !topicsEl) return;
  if (typeof LexPrepApi === 'undefined') return;

  const client = LexPrepApi.getClient();
  Promise.all([
    client.from('disciplines').select('*', { count: 'exact', head: true }),
    client.from('topics').select('*', { count: 'exact', head: true })
  ]).then(([disciplines, topics]) => {
    if (disciplinesEl && typeof disciplines.count === 'number' && disciplines.count > 0) {
      setStatNumber(disciplinesEl, disciplines.count);
    }
    if (topicsEl && typeof topics.count === 'number' && topics.count > 0) {
      setStatNumber(topicsEl, topics.count);
    }
  }).catch(() => {});
}

/* ---------------- Уведомление о новом уровне/звании ----------------
   progress.js кидает событие 'lexprep:levelup' (см. checkLevelUp() там)
   при любом действии, поднимающем XP выше границы следующего уровня —
   карточки, тесты, экзамен. Слушатель здесь один на все страницы, чтобы
   всплывающее окно выглядело одинаково независимо от того, где именно
   человек прокачался. */
function initLevelUpToast() {
  window.addEventListener('lexprep:levelup', (e) => {
    showLevelUpToast(e.detail);
  });
}

function showLevelUpToast(detail) {
  const existing = document.querySelector('.levelup-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'levelup-toast';
  toast.innerHTML = `
    <div class="levelup-toast__card">
      <button type="button" class="levelup-toast__close" aria-label="Закрыть">&times;</button>
      <div class="levelup-toast__glow"></div>
      <img class="levelup-toast__icon" src="assets/badges/${detail.rankIcon}" alt="${detail.rankName}" />
      <div class="levelup-toast__eyebrow">${detail.rankChanged ? 'Новое звание!' : 'Новый уровень!'}</div>
      <div class="levelup-toast__level">Уровень ${detail.level}</div>
      <div class="levelup-toast__rank">${detail.rankName}</div>
    </div>
  `;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('is-visible'));

  function close() {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }

  toast.querySelector('.levelup-toast__close').addEventListener('click', close);
  toast.addEventListener('click', (e) => { if (e.target === toast) close(); });
  setTimeout(close, 6000);
}

/* ---------------- Coin balance badge (shop shortcut) ---------------- */
function initCoinBadge() {
  const countEl = document.getElementById('coinCount');
  if (!countEl || typeof LexPrepProgress === 'undefined' || typeof LexPrepProgress.getCoins !== 'function') return;
  countEl.textContent = LexPrepProgress.getCoins();
}

/* ---------------- Online users counter (demo, no real backend/websocket yet) ---------------- */
function initOnlineCounter() {
  const countEl = document.getElementById('onlineCount');
  if (!countEl) return;

  function computeBase() {
    const hour = new Date().getHours();
    const activity = hour >= 8 && hour <= 23 ? 1 : 0.4;
    return Math.round((60 + Math.random() * 60) * activity);
  }

  let current = Number(sessionStorage.getItem('lexprep_online_count')) || computeBase();
  countEl.textContent = current;

  setInterval(() => {
    const drift = Math.round((Math.random() - 0.5) * 6);
    current = Math.max(12, current + drift);
    sessionStorage.setItem('lexprep_online_count', String(current));
    countEl.textContent = current;
  }, 4000 + Math.random() * 3000);
}

/* ---------------- Header shadow on scroll ---------------- */
function initHeaderScroll() {
  const header = document.getElementById('header');
  if (!header) return;
  const toggle = () => {
    if (window.scrollY > 8) {
      header.classList.add('is-scrolled');
    } else {
      header.classList.remove('is-scrolled');
    }
  };
  toggle();
  window.addEventListener('scroll', toggle, { passive: true });
}

/* ---------------- Mobile burger menu ---------------- */
function initMobileNav() {
  const burger = document.getElementById('burger');
  const mobileNav = document.getElementById('mobileNav');
  if (!burger || !mobileNav) return;
  burger.addEventListener('click', () => {
    const isOpen = burger.classList.toggle('is-active');
    mobileNav.classList.toggle('is-open', isOpen);
    burger.setAttribute('aria-expanded', String(isOpen));
  });
  mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      burger.classList.remove('is-active');
      mobileNav.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });
}

/* ---------------- Smooth scroll for in-page anchors ---------------- */
function initSmoothAnchors() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      if (targetId.length <= 1) return;
      const target = document.querySelector(targetId);
      if (!target) return;
      e.preventDefault();
      const headerHeight = document.getElementById('header')?.offsetHeight || 0;
      const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 12;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
}

/* ---------------- FAQ accordion ---------------- */
function initAccordion() {
  const items = document.querySelectorAll('#accordion .accordion__item');
  items.forEach(item => {
    const trigger = item.querySelector('.accordion__trigger');
    const panel = item.querySelector('.accordion__panel');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', () => {
      const isOpen = item.classList.contains('is-open');
      items.forEach(other => {
        other.classList.remove('is-open');
        other.querySelector('.accordion__panel').style.maxHeight = null;
        other.querySelector('.accordion__trigger').setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        item.classList.add('is-open');
        panel.style.maxHeight = panel.scrollHeight + 'px';
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/* ---------------- Hero: живое демо темы ----------------
   Карточка сама проходит шаги Конспект → Практика → Карточки → Тест.
   Переход к следующему шагу делает не setInterval, а конец CSS-анимации
   полоски-таймера под активной вкладкой: так пауза при наведении и вне
   экрана (animation-play-state) останавливает и таймер, и переключение.
   Опыт в плашке уровня считается по тем же правилам, что в progress.js
   (+8 за конспект, +2 за карточку, +2 за верный ответ в тесте). */
function initHeroStudy() {
  const visual = document.getElementById('heroStudy');
  if (!visual) return;
  const card = visual.querySelector('.study-card');
  const tabs = Array.from(visual.querySelectorAll('[data-study-tab]'));
  const scenes = Array.from(visual.querySelectorAll('[data-study-scene]'));
  const progressBar = document.getElementById('studyProgressBar');
  const progressValue = document.getElementById('studyProgressValue');
  const progressBox = visual.querySelector('.study-progress');
  const toast = document.getElementById('heroToast');
  const toastIcon = document.getElementById('heroToastIcon');
  const toastTitle = document.getElementById('heroToastTitle');
  const toastText = document.getElementById('heroToastText');
  const level = visual.querySelector('.hero-level');
  const levelValue = document.getElementById('heroLevelValue');
  const levelBar = document.getElementById('heroLevelBar');
  const levelPlus = document.getElementById('heroLevelPlus');
  if (!card || !tabs.length || !scenes.length) return;

  const reducedMotion = prefersReducedMotion();
  // Когда шаг отыгран и пора показать уведомление (мс от начала шага) и
  // сколько всего длится шаг — подогнано под анимации сцен в style.css.
  const TIMING = {
    notes: { toastAt: 1700, duration: 4800 },
    practice: { toastAt: 1800, duration: 4800 },
    cards: { toastAt: 3000, duration: 5600 },
    test: { toastAt: 2100, duration: 5200 }
  };
  const xpThreshold = (lvl) => Math.round(100 * (lvl - 1) * lvl / 2);
  let xp = 1452; // уровень 5, почти следующий — через пару кругов демо будет «новый уровень»
  let current = -1;
  let toastTimer = null;

  function renderLevel(animateBump) {
    let lvl = 1;
    while (xpThreshold(lvl + 1) <= xp) lvl++;
    const from = xpThreshold(lvl);
    const to = xpThreshold(lvl + 1);
    const prevLevel = levelValue ? Number(levelValue.textContent) : lvl;
    if (levelValue) levelValue.textContent = lvl;
    if (levelBar) levelBar.style.width = Math.max(3, Math.round((xp - from) / (to - from) * 100)) + '%';
    if (level && animateBump) {
      restartClass(level, 'is-bump');
      if (lvl > prevLevel) {
        level.classList.add('is-levelup');
        setTimeout(() => level.classList.remove('is-levelup'), 2200);
      }
    }
  }

  function awardXp(amount) {
    if (!amount) return;
    xp += amount;
    if (levelPlus) {
      levelPlus.textContent = `+${amount} XP`;
      restartClass(levelPlus, 'is-shown');
    }
    renderLevel(true);
  }

  function showToast(scene) {
    if (!toast) return;
    toastIcon.textContent = scene.dataset.toastIcon || '';
    toastTitle.textContent = scene.dataset.toastTitle || '';
    toastText.textContent = scene.dataset.toastText || '';
    toast.classList.add('is-visible');
    awardXp(Number(scene.dataset.xp) || 0);
  }

  function burstSparks() {
    if (!progressBox || reducedMotion) return;
    const colors = ['var(--color-primary)', 'var(--color-accent)', '#8c54ff', 'var(--color-success)'];
    for (let i = 0; i < 12; i++) {
      const spark = document.createElement('span');
      spark.className = 'study-spark';
      const angle = (-160 + Math.random() * 140) * Math.PI / 180;
      const dist = 26 + Math.random() * 34;
      spark.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      spark.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      spark.style.setProperty('--spark-color', colors[i % colors.length]);
      spark.style.animationDelay = `${Math.random() * 120}ms`;
      spark.addEventListener('animationend', () => spark.remove());
      progressBox.appendChild(spark);
    }
  }

  function activate(index, { withToast = true } = {}) {
    if (index === current) return;
    current = index;
    const tab = tabs[index];
    const key = tab.dataset.studyTab;
    const scene = scenes.find(s => s.dataset.studyScene === key);

    tabs.forEach(t => {
      const isActive = t === tab;
      t.classList.toggle('is-active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    scenes.forEach(s => {
      const isActive = s === scene;
      s.classList.toggle('is-active', isActive);
      // is-played снимаем только у сцены, которая сейчас начнётся заново —
      // уходящая сцена досматривается в своём конечном состоянии.
      if (isActive) restartClass(s, 'is-played');
    });

    const timing = TIMING[key] || { toastAt: 1800, duration: 5000 };
    visual.style.setProperty('--study-duration', `${timing.duration}ms`);

    const progress = Number(tab.dataset.progress) || 0;
    if (progressBar) progressBar.style.width = progress + '%';
    if (progressValue) countTo(progressValue, progress, 700);
    if (progress === 100) setTimeout(burstSparks, reducedMotion ? 0 : 900);

    if (toast) {
      toast.classList.remove('is-visible');
      clearTimeout(toastTimer);
      if (withToast && scene) {
        toastTimer = setTimeout(() => showToast(scene), reducedMotion ? 0 : timing.toastAt);
      }
    }
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(i));
    const timer = tab.querySelector('.study-tab__timer');
    if (timer) {
      timer.addEventListener('animationend', () => {
        if (tab.classList.contains('is-active')) activate((i + 1) % tabs.length);
      });
    }
  });

  renderLevel(false);
  // Демо стартует, когда карточка реально видна (на телефонах она ниже
  // первого экрана), и не раньше, чем отыграет анимация появления hero.
  // До старта видна статичная сцена конспекта из разметки. Вне экрана
  // таймер шага стоит на паузе.
  let started = false;
  const readyAt = performance.now() + (reducedMotion ? 0 : 700);
  const start = () => {
    if (started) return;
    started = true;
    activate(0);
    if (!reducedMotion) visual.classList.add('is-playing');
  };
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting && entry.intersectionRatio >= 0.3;
      visual.classList.toggle('is-paused', !visible);
      if (visible && !started) setTimeout(start, Math.max(0, readyAt - performance.now()));
    }, { threshold: [0, 0.3] }).observe(visual);
  } else {
    setTimeout(start, readyAt - performance.now());
  }

  // Наклон карточки, блик и параллакс плашек — только для мыши.
  if (!reducedMotion && window.matchMedia('(pointer: fine)').matches) {
    let frame = 0;
    visual.addEventListener('mousemove', (e) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = visual.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `rotateY(${x * 9}deg) rotateX(${-y * 9}deg)`;
        const cardRect = card.getBoundingClientRect();
        card.style.setProperty('--glare-x', `${e.clientX - cardRect.left}px`);
        card.style.setProperty('--glare-y', `${e.clientY - cardRect.top}px`);
        visual.style.setProperty('--px', x.toFixed(3));
        visual.style.setProperty('--py', y.toFixed(3));
      });
    });
    visual.addEventListener('mouseenter', () => visual.classList.add('is-hovered'));
    visual.addEventListener('mouseleave', () => {
      cancelAnimationFrame(frame);
      visual.classList.remove('is-hovered');
      card.style.transform = '';
      visual.style.setProperty('--px', '0');
      visual.style.setProperty('--py', '0');
    });
  }
}

/* Мягкий «прожектор» за курсором на фоне первого экрана. */
function initHeroBackground() {
  const hero = document.getElementById('hero');
  if (!hero || prefersReducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
  let frame = 0;
  hero.addEventListener('mousemove', (e) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rect = hero.getBoundingClientRect();
      hero.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
      hero.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
    });
  });
  hero.addEventListener('mouseenter', () => hero.classList.add('has-spotlight'));
  hero.addEventListener('mouseleave', () => hero.classList.remove('has-spotlight'));
}

/* Разбивает заголовок первого экрана на слова, чтобы они появлялись по
   очереди (задержка — через --i, см. .hero-word в style.css). Акцентный
   фрагмент анимируется целиком, иначе ломается градиентный текст. */
function initHeroTitle() {
  const title = document.querySelector('.hero__title');
  if (!title || title.classList.contains('is-split') || prefersReducedMotion()) return;
  let index = 0;
  Array.from(title.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach(part => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          return;
        }
        const word = document.createElement('span');
        word.className = 'hero-word';
        word.style.setProperty('--i', index++);
        word.textContent = part;
        frag.appendChild(word);
      });
      node.replaceWith(frag);
    } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('accent')) {
      node.classList.add('hero-word');
      node.style.setProperty('--i', index++);
    }
  });
  title.classList.add('is-split');
}

/* Цифры под первым экраном набегают от нуля. Если initCatalogStats успеет
   получить реальные числа раньше, чем стартует анимация, она подхватит их
   вместо зашитых в HTML (см. setStatNumber). */
function initStatCounters() {
  if (prefersReducedMotion()) return;
  document.querySelectorAll('.hero__stats .stat__num').forEach(el => {
    const target = parseInt(el.textContent, 10);
    if (!Number.isFinite(target)) return;
    el.dataset.countTarget = target;
    el.dataset.countPending = '1';
    el.textContent = '0';
    setTimeout(() => {
      delete el.dataset.countPending;
      countTo(el, Number(el.dataset.countTarget), 1400);
    }, 900);
  });
}

function setStatNumber(el, value) {
  if (el.dataset.countPending === '1') {
    el.dataset.countTarget = value;
  } else {
    countTo(el, value, 900);
  }
}

function countTo(el, target, duration) {
  cancelAnimationFrame(el._countFrame);
  const from = parseInt(el.textContent, 10) || 0;
  if (from === target || prefersReducedMotion()) {
    el.textContent = target;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (t < 1) el._countFrame = requestAnimationFrame(step);
  };
  el._countFrame = requestAnimationFrame(step);
}

/* «Как проходит подготовка»: линия дорисовывается, шаги загораются по
   очереди — запускается тем же reveal-наблюдателем (класс is-visible). */
function initRoadmap() {
  document.querySelectorAll('.roadmap__step').forEach((step, i) => {
    step.style.setProperty('--step', i);
  });
  document.querySelectorAll('.feature-tabs__item').forEach((item, i) => {
    item.style.setProperty('--item', i);
  });
}

function restartClass(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // перезапуск CSS-анимации
  el.classList.add(className);
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------------- Возможности: вкладки с превью ---------------- */
function initFeatureTabs() {
  const root = document.getElementById('featureTabs');
  if (!root) return;
  const tabs = root.querySelectorAll('[data-feature-tab]');
  const panels = root.querySelectorAll('[data-feature-panel]');
  const preview = root.querySelector('.feature-tabs__preview');

  const initialTab = root.querySelector('[data-feature-tab].is-active') || tabs[0];
  if (preview && initialTab) preview.style.setProperty('--tab-accent', initialTab.style.getPropertyValue('--tab-accent'));

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.featureTab;
      tabs.forEach(t => t.classList.toggle('is-active', t === tab));
      panels.forEach(p => p.classList.toggle('is-active', p.dataset.featurePanel === key));
      if (preview) preview.style.setProperty('--tab-accent', tab.style.getPropertyValue('--tab-accent'));
    });
  });
}

/* ---------------- Feedback form ---------------- */
function initFeedbackForm() {
  const form = document.getElementById('feedbackForm');
  const success = document.getElementById('feedbackSuccess');
  const emailInput = document.getElementById('fbEmail');
  const nameInput = document.getElementById('fbName');
  const messageInput = document.getElementById('fbMessage');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (emailInput && !validateEmailField(emailInput)) {
      emailInput.focus();
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await LexPrepApi.submitHomepageFeedback({
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        message: messageInput.value.trim()
      });
      form.reset();
      if (success) {
        success.classList.add('is-visible');
        setTimeout(() => success.classList.remove('is-visible'), 4000);
      }
    } catch (err) {
      alert('Не удалось отправить сообщение: ' + err.message);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

/* ---------------- Helpers ---------------- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------- Reveal on scroll ---------------- */
function initRevealOnScroll() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  items.forEach(item => observer.observe(item));
}

function applyAuthUi(user) {
  document.body.classList.toggle('is-authed', !!user);
  document.body.classList.toggle('is-guest', !user);
  document.body.classList.toggle('is-admin', !!(user && user.isAdmin));
  document.body.classList.toggle('is-moderator', !!(user && (user.isModerator || user.isAdmin)));

  if (user) {
    const nameEl = document.getElementById('profileName');
    const avatarEl = document.getElementById('profileAvatar');
    if (nameEl) nameEl.textContent = user.name || 'Профиль';
    if (avatarEl) {
      if (user.avatar) {
        avatarEl.textContent = '';
        avatarEl.style.backgroundImage = `url(${user.avatar})`;
        avatarEl.classList.add('has-image');
      } else {
        avatarEl.textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
        avatarEl.style.backgroundImage = '';
        avatarEl.classList.remove('has-image');
      }

      avatarEl.classList.remove('avatar-frame--bronze', 'avatar-frame--gold', 'avatar-frame--platinum', 'avatar-frame--ruby', 'avatar-frame--neon-blue', 'avatar-frame--neon-purple');
      const equippedFrame = localStorage.getItem('lexprep_shop_equipped');
      if (equippedFrame && equippedFrame !== 'none') {
        avatarEl.classList.add(`avatar-frame--${equippedFrame}`);
      }
    }
  }

  initCoinBadge();
}

function initAuthState() {
  // Синхронный рендер из локального кэша — чтобы не мигать гостевым
  // состоянием, пока идёт запрос к /api/auth/me.
  const cachedUser = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  applyAuthUi(cachedUser);

  const profileBtn = document.getElementById('profileBtn');
  const dropdown = document.getElementById('profileDropdown');
  if (profileBtn && dropdown) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('is-open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('is-open'));
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      const finish = () => {
        localStorage.removeItem('lexprep_user');
        // Иначе на общем устройстве следующий вошедший увидит переписку с
        // ИИ-консультантом от прошлого аккаунта (см. app.js initAiChat).
        localStorage.removeItem('lexprep_ai_chat_history');
        window.location.reload();
      };
      if (typeof LexPrepApi !== 'undefined') {
        LexPrepApi.logout().then(finish).catch(finish);
      } else {
        finish();
      }
    });
  }

  // Досверяем сессию у сервера в фоне — если она реально протухла или
  // была завершена в другой вкладке, локальный кэш это не знает. Если
  // бэкенд просто недоступен (сеть/офлайн), кэш не трогаем — это не
  // повод разлогинивать человека.
  if (typeof LexPrepApi !== 'undefined') {
    LexPrepApi.me()
      .then(user => {
        if (user.isBanned) {
          LexPrepApi.logout().catch(() => {});
          localStorage.removeItem('lexprep_user');
          LexPrepDialog.alert('Аккаунт заблокирован' + (user.banReason ? `: ${user.banReason}` : '.')).then(() => {
            window.location.href = 'auth.html';
          });
          return;
        }
        // Мержим, а не заменяем целиком — на фронтенде у user есть поля
        // (university, course и т.д.), которых бэкенд пока не знает.
        const merged = { ...cachedUser, ...user };
        localStorage.setItem('lexprep_user', JSON.stringify(merged));
        applyAuthUi(merged);
      })
      .catch(err => {
        if (err.status === 401 && cachedUser) {
          localStorage.removeItem('lexprep_user');
          applyAuthUi(null);
        }
      });
  }
}