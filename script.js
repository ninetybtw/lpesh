/* ==========================================================================
SCRIPT.JS — интерактивность: меню, аккордеон, демо-навигация, hero-анимация,
форма обратной связи
========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initHeaderScroll();
  initMobileNav();
  initSmoothAnchors();
  initAccordion();
  initHeroCoin3D();
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
      disciplinesEl.textContent = disciplines.count;
    }
    if (topicsEl && typeof topics.count === 'number' && topics.count > 0) {
      topicsEl.textContent = topics.count;
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

/* ---------------- Hero: вращаемая 3D-монета ----------------
   Чистый CSS 3D (perspective + preserve-3d + rotateY) — без
   Three.js/WebGL/моделей, чтобы не тянуть лишний вес на страницу. Две
   грани с backface-visibility:hidden, вторая развёрнута на 180° — та же
   схема, на которой обычно строят переворот игральной карты, только
   крутится по кругу через перетаскивание, а не по hover. Управление —
   Pointer Events (единый код для мыши и тача), с инерцией после
   отпускания и медленным авто-вращением в состоянии покоя. */
function initHeroCoin3D() {
  const coin = document.getElementById('heroCoin');
  const stage = document.getElementById('heroCoinStage');
  if (!coin || !stage) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const idleSpeed = reduceMotion ? 0 : 0.35;

  let rotY = -25;
  let velocity = idleSpeed;
  let dragging = false;
  let lastX = 0;
  let lastTime = 0;
  let rafId = null;

  function render() {
    stage.style.transform = `rotateX(-10deg) rotateY(${rotY}deg)`;
  }
  render();

  function tick() {
    if (!dragging) {
      rotY += velocity;
      render();
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  function settleToIdle() {
    if (Math.abs(velocity) > Math.abs(idleSpeed) + 0.05) {
      velocity *= 0.95;
      setTimeout(settleToIdle, 16);
    } else {
      velocity = idleSpeed;
    }
  }

  coin.addEventListener('pointerdown', (e) => {
    dragging = true;
    coin.classList.add('is-dragging');
    lastX = e.clientX;
    lastTime = performance.now();
    coin.setPointerCapture(e.pointerId);
  });

  coin.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now();
    const dx = e.clientX - lastX;
    const dt = Math.max(now - lastTime, 1);
    rotY += dx * 0.5;
    velocity = (dx * 0.5) / (dt / 16.6);
    lastX = e.clientX;
    lastTime = now;
    render();
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    coin.classList.remove('is-dragging');
    velocity = reduceMotion ? 0 : Math.max(Math.min(velocity, 10), -10);
    settleToIdle();
  }
  coin.addEventListener('pointerup', endDrag);
  coin.addEventListener('pointercancel', endDrag);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && rafId) cancelAnimationFrame(rafId);
    else if (!document.hidden) rafId = requestAnimationFrame(tick);
  });
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