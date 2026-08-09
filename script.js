/* ==========================================================================
SCRIPT.JS — интерактивность: меню, аккордеон, демо-навигация, hero-анимация,
форма обратной связи
========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initHeaderScroll();
  initMobileNav();
  initSmoothAnchors();
  initAccordion();
  initDemoNavigation();
  initHeroMock();
  initFeedbackForm();
  initRevealOnScroll();
  initAuthState();
  initOnlineCounter();
});

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
    burger.classList.toggle('is-active');
    mobileNav.classList.toggle('is-open');
  });
  mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      burger.classList.remove('is-active');
      mobileNav.classList.remove('is-open');
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

  if (chips.length && progressBar) {
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('mock-chip--active'));
        chip.classList.add('mock-chip--active');
        const value = chip.dataset.progress || '62';
        progressBar.style.width = value + '%';
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

/* ---------------- Demo navigation (Avito-style) ---------------- */
const DEMO_DATA = {
  civil: {
    subjects: [
      { id: 'obligations', name: 'Обязательственное право' },
      { id: 'property', name: 'Вещное право' },
      { id: 'contracts', name: 'Договорное право' },
    ],
    topics: {
      obligations: { title: 'Понятие и виды обязательств', tags: ['Конспект', 'Карточки', 'Тест', 'Практика ВС РФ'] },
      property: { title: 'Право собственности и его формы', tags: ['Конспект', 'Карточки', 'Билеты к экзамену'] },
      contracts: { title: 'Существенные условия договора', tags: ['Конспект', 'Тест', 'Судебная практика'] },
    },
  },
  ip: {
    subjects: [
      { id: 'copyright', name: 'Авторское право' },
      { id: 'patent', name: 'Патентное право' },
      { id: 'trademark', name: 'Товарные знаки' },
    ],
    topics: {
      copyright: { title: 'Объекты авторских прав', tags: ['Конспект', 'Карточки', 'Тест'] },
      patent: { title: 'Условия патентоспособности', tags: ['Конспект', 'Практика Роспатента'] },
      trademark: { title: 'Регистрация товарного знака', tags: ['Конспект', 'Карточки', 'Билеты к экзамену'] },
    },
  },
  constitutional: {
    subjects: [
      { id: 'rights', name: 'Права и свободы человека' },
      { id: 'system', name: 'Система органов власти' },
      { id: 'amendments', name: 'Порядок изменения Конституции' },
    ],
    topics: {
      rights: { title: 'Классификация конституционных прав', tags: ['Конспект', 'Карточки', 'Практика КС РФ'] },
      system: { title: 'Разделение властей в РФ', tags: ['Конспект', 'Тест', 'Билеты к экзамену'] },
      amendments: { title: 'Процедура внесения поправок', tags: ['Конспект', 'Карточки'] },
    },
  },
  criminal: {
    subjects: [
      { id: 'proceedings', name: 'Стадии уголовного процесса' },
      { id: 'evidence', name: 'Доказательства' },
      { id: 'appeal', name: 'Апелляция и кассация' },
    ],
    topics: {
      proceedings: { title: 'Возбуждение уголовного дела', tags: ['Конспект', 'Карточки', 'Тест'] },
      evidence: { title: 'Виды и допустимость доказательств', tags: ['Конспект', 'Практика судов', 'Билеты к экзамену'] },
      appeal: { title: 'Основания для отмены приговора', tags: ['Конспект', 'Карточки'] },
    },
  },
  international: {
    subjects: [
      { id: 'treaties', name: 'Международные договоры' },
      { id: 'jurisdiction', name: 'Юрисдикция государств' },
      { id: 'humanrights', name: 'Международное право прав человека' },
    ],
    topics: {
      treaties: { title: 'Порядок заключения договоров', tags: ['Конспект', 'Тест'] },
      jurisdiction: { title: 'Принципы экстерриториальности', tags: ['Конспект', 'Карточки', 'Практика ЕСПЧ'] },
      humanrights: { title: 'Механизмы защиты прав человека', tags: ['Конспект', 'Карточки', 'Билеты к экзамену'] },
    },
  },
};

function initDemoNavigation() {
  const categoryButtons = document.querySelectorAll('.demo__category');
  const subjectsContainer = document.getElementById('demoSubjects');
  const topicContainer = document.getElementById('demoTopic');
  if (!categoryButtons.length || !subjectsContainer || !topicContainer) return;

  function renderSubjects(categoryKey) {
    const category = DEMO_DATA[categoryKey];
    subjectsContainer.innerHTML = '';
    category.subjects.forEach((subject, index) => {
      const btn = document.createElement('button');
      btn.className = 'demo__subject' + (index === 0 ? ' is-active' : '');
      btn.textContent = subject.name;
      btn.dataset.subject = subject.id;
      btn.addEventListener('click', () => {
        subjectsContainer.querySelectorAll('.demo__subject').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        renderTopic(categoryKey, subject.id);
      });
      subjectsContainer.appendChild(btn);
    });
    if (category.subjects.length) {
      renderTopic(categoryKey, category.subjects[0].id);
    }
  }

  function renderTopic(categoryKey, subjectId) {
    const topic = DEMO_DATA[categoryKey].topics[subjectId];
    if (!topic) {
      topicContainer.innerHTML = '<p class="demo__topic-placeholder">Тема не найдена</p>';
      return;
    }
    topicContainer.innerHTML = `
      <div class="demo__topic-title">${escapeHtml(topic.title)}</div>
      <div class="demo__topic-tags">
        ${topic.tags.map(tag => `<span class="demo__topic-tag">${escapeHtml(tag)}</span>`).join('')}
      </div>
    `;
  }

  categoryButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryButtons.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      renderSubjects(btn.dataset.category);
    });
  });

  renderSubjects(categoryButtons[0].dataset.category);
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

function initAuthState() {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  document.body.classList.toggle('is-authed', !!user);
  document.body.classList.toggle('is-guest', !user);

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
    }
  }

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
      localStorage.removeItem('lexprep_user');
      window.location.reload();
    });
  }
}