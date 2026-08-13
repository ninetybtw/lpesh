/* ==========================================================================
SCRIPT.JS — интерактивность: меню, аккордеон, демо-навигация, hero-анимация,
форма обратной связи
========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initHeaderScroll();
  initMobileNav();
  initSmoothAnchors();
  initAccordion();
  initHeroMock();
  initFeedbackForm();
  initRevealOnScroll();
  initAuthState();
  initOnlineCounter();
});

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

/* ---------------- Hero mock-card: clickable chips + 3D tilt ---------------- */
function initHeroMock() {
  const visual = document.querySelector('.hero__visual');
  const card = document.querySelector('.mock-card');
  const chips = document.querySelectorAll('.mock-chip');
  const progressBar = document.querySelector('.mock-progress__bar');
  const infoBox = document.getElementById('mockInfo');
  const infoTitle = infoBox ? infoBox.querySelector('.mock-info__title') : null;
  const infoDesc = infoBox ? infoBox.querySelector('.mock-info__desc') : null;

  if (chips.length && progressBar) {
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.classList.contains('mock-chip--active')) return;
        chips.forEach(c => c.classList.remove('mock-chip--active'));
        chip.classList.add('mock-chip--active');
        const value = chip.dataset.progress || '62';
        progressBar.style.width = value + '%';

        if (infoBox && infoTitle && infoDesc) {
          infoBox.classList.remove('mock-info--enter');
          void infoBox.offsetWidth; // перезапуск CSS-анимации
          infoTitle.textContent = chip.textContent.trim();
          infoDesc.textContent = chip.dataset.desc || '';
          infoBox.classList.add('mock-info--enter');
        }
      });
    });
  }

  if (visual && card && window.matchMedia('(pointer: fine)').matches) {
    visual.addEventListener('mousemove', (e) => {
      const rect = visual.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
    });
    visual.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  }
}

/* ---------------- Feedback form ---------------- */
function initFeedbackForm() {
  const form = document.getElementById('feedbackForm');
  const success = document.getElementById('feedbackSuccess');
  const emailInput = document.getElementById('fbEmail');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (emailInput && !validateEmailField(emailInput)) {
      emailInput.focus();
      return;
    }

    form.reset();
    if (success) {
      success.classList.add('is-visible');
      setTimeout(() => success.classList.remove('is-visible'), 4000);
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
          alert('Аккаунт заблокирован' + (user.banReason ? `: ${user.banReason}` : '.'));
          window.location.href = 'auth.html';
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