/* ==========================================================================
PROFILE.JS — личный кабинет: навигация по разделам, редактирование профиля,
подписка, статистика (демо), настройки и переключатель темы
========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }

  initSections();
  initProfileHero(user);
  initAvatarEditor(user);
  initInfoForm(user);
  initPayment();
  initSubscription();
  initStats();
  initGamification();
  initMyArticles();
  initReferral();
  initThemeSwitch();
  initNotificationsSwitch();
  initPasswordForm();
  initPrivacyModal();
  initDangerZone();
});

function getUser() {
  return JSON.parse(localStorage.getItem('lexprep_user') || 'null') || {};
}

function saveUser(patch) {
  const user = { ...getUser(), ...patch };
  localStorage.setItem('lexprep_user', JSON.stringify(user));
  return user;
}

/* ---------------- Section navigation ---------------- */
function initSections() {
  const navItems = document.querySelectorAll('.profile-nav__item');
  const panels = document.querySelectorAll('[data-section-panel]');

  function activate(section) {
    navItems.forEach(item => item.classList.toggle('is-active', item.dataset.section === section));
    panels.forEach(panel => panel.classList.toggle('is-active', panel.dataset.sectionPanel === section));
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      activate(item.dataset.section);
      history.replaceState(null, '', `#${item.dataset.section}`);
    });
  });

  const initial = window.location.hash.replace('#', '');
  const validSections = Array.from(navItems).map(i => i.dataset.section);
  activate(validSections.includes(initial) ? initial : 'info');
}

/* ---------------- Hero + avatar helpers ---------------- */
const AVATAR_FRAME_CLASSES = ['avatar-frame--bronze', 'avatar-frame--gold', 'avatar-frame--platinum', 'avatar-frame--ruby', 'avatar-frame--neon-blue', 'avatar-frame--neon-purple'];

function renderAvatar(el, user) {
  if (!el) return;
  if (user.avatar) {
    el.textContent = '';
    el.style.backgroundImage = `url(${user.avatar})`;
  } else {
    el.textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
    el.style.backgroundImage = '';
  }

  el.classList.remove(...AVATAR_FRAME_CLASSES);
  const equipped = localStorage.getItem('lexprep_shop_equipped');
  if (equipped && equipped !== 'none') {
    el.classList.add(`avatar-frame--${equipped}`);
  }
}

function refreshAllAvatars(user) {
  renderAvatar(document.getElementById('heroAvatar'), user);
  renderAvatar(document.getElementById('avatarPreview'), user);
  const headerAvatar = document.getElementById('profileAvatar');
  if (headerAvatar) {
    renderAvatar(headerAvatar, user);
    headerAvatar.classList.toggle('has-image', !!user.avatar);
  }
}

function initProfileHero(user) {
  document.getElementById('heroName').textContent = user.name || 'Профиль';
  document.getElementById('heroEmail').textContent = user.email || '';
  refreshAllAvatars(user);
}

/* ---------------- Avatar editor ---------------- */
function initAvatarEditor() {
  const changeBtn = document.getElementById('changeAvatarBtn');
  const removeBtn = document.getElementById('removeAvatarBtn');
  const input = document.getElementById('avatarInput');

  changeBtn?.addEventListener('click', () => input.click());

  input?.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const user = saveUser({ avatar: reader.result });
      refreshAllAvatars(user);
    };
    reader.readAsDataURL(file);
  });

  removeBtn?.addEventListener('click', () => {
    const user = saveUser({ avatar: '' });
    refreshAllAvatars(user);
  });
}

/* ---------------- Personal info form ---------------- */
function initInfoForm(user) {
  const form = document.getElementById('infoForm');
  if (!form) return;

  document.getElementById('fieldName').value = user.name || '';
  document.getElementById('fieldEmail').value = user.email || '';
  document.getElementById('fieldUniversity').value = user.university || '';
  document.getElementById('fieldCourse').value = user.course || '';

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const emailInput = document.getElementById('fieldEmail');
    if (!validateEmailField(emailInput)) {
      emailInput.focus();
      return;
    }

    const updated = saveUser({
      name: document.getElementById('fieldName').value.trim() || 'Профиль',
      email: emailInput.value.trim(),
      university: document.getElementById('fieldUniversity').value.trim(),
      course: document.getElementById('fieldCourse').value.trim()
    });

    document.getElementById('heroName').textContent = updated.name;
    document.getElementById('heroEmail').textContent = updated.email;
    const headerName = document.getElementById('profileName');
    if (headerName) headerName.textContent = updated.name;

    const success = document.getElementById('infoSuccess');
    success.classList.add('is-visible');
    setTimeout(() => success.classList.remove('is-visible'), 3000);
  });
}

/* ---------------- Payment (demo only, nothing is sent anywhere) ---------------- */
function initPayment() {
  const display = document.getElementById('paymentDisplay');
  const form = document.getElementById('paymentForm');
  const summary = document.getElementById('paymentSummary');
  const editBtn = document.getElementById('editPaymentBtn');
  const cancelBtn = document.getElementById('cancelPaymentBtn');

  const saved = JSON.parse(localStorage.getItem('lexprep_payment') || 'null');
  if (saved && saved.last4) {
    summary.textContent = `•••• •••• •••• ${saved.last4}`;
  }

  editBtn.addEventListener('click', () => {
    display.hidden = true;
    form.hidden = false;
  });

  cancelBtn.addEventListener('click', () => {
    form.hidden = true;
    display.hidden = false;
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const number = document.getElementById('fieldCardNumber').value.replace(/\s+/g, '');
    const last4 = number.slice(-4) || '0000';
    localStorage.setItem('lexprep_payment', JSON.stringify({ last4 }));
    summary.textContent = `•••• •••• •••• ${last4}`;
    form.reset();
    form.hidden = true;
    display.hidden = false;
  });
}

/* ---------------- Subscription ---------------- */
function initSubscription() {
  const cancelBtn = document.getElementById('cancelSubBtn');
  const note = document.getElementById('planNote');

  function applyState() {
    const cancelled = localStorage.getItem('lexprep_sub_cancelled') === '1';
    note.hidden = !cancelled;
    cancelBtn.textContent = cancelled ? 'Возобновить подписку' : 'Отменить подписку';
  }

  cancelBtn.addEventListener('click', () => {
    const cancelled = localStorage.getItem('lexprep_sub_cancelled') === '1';
    if (!cancelled) {
      const confirmed = window.confirm('Отменить подписку? Доступ к тарифу «Про» сохранится до конца оплаченного периода.');
      if (!confirmed) return;
      localStorage.setItem('lexprep_sub_cancelled', '1');
    } else {
      localStorage.removeItem('lexprep_sub_cancelled');
    }
    applyState();
  });

  applyState();
}

/* ---------------- Stats (real data from LexPrepProgress) ---------------- */
function initStats() {
  if (typeof LexPrepProgress === 'undefined' || typeof LEXPREP_DATA === 'undefined') return;

  const stats = LexPrepProgress.getStats(LEXPREP_DATA);
  document.getElementById('statTopics').textContent = stats.topicsTouched;
  document.getElementById('statTests').textContent = stats.testsCount;
  document.getElementById('statAvg').textContent = stats.avgScorePercent === null ? '—' : `${stats.avgScorePercent}%`;
  document.getElementById('statStreak').textContent = stats.streakDays;
  document.getElementById('statCards').textContent = stats.cardsReviewed;

  const recentList = document.getElementById('recentResultsList');
  if (stats.recent.length) {
    recentList.innerHTML = stats.recent.map(r => {
      const percent = Math.round((r.score / r.total) * 100);
      const scoreClass = percent >= 80 ? 'results-row__score--good' : percent >= 50 ? 'results-row__score--mid' : 'results-row__score--bad';
      return `
        <div class="results-row">
          <span class="results-row__topic">${escapeAttr(r.title)}</span>
          <span class="results-row__score ${scoreClass}">${r.score} / ${r.total}</span>
        </div>
      `;
    }).join('');
  }

  const weak = LexPrepProgress.getWeakQuestions(LEXPREP_DATA, 5);
  const weakList = document.getElementById('weakSpotsList');
  const reviewLink = document.getElementById('reviewWeakLink');
  if (weak.length) {
    weakList.innerHTML = weak.map(w => `
      <div class="results-row">
        <span class="results-row__topic">${escapeAttr(w.topicTitle)}</span>
        <span class="results-row__score results-row__score--bad">${escapeAttr(w.question.question)}</span>
      </div>
    `).join('');
    reviewLink.hidden = false;
  }
}

/* ---------------- Level, rank and achievements ---------------- */
function initGamification() {
  if (typeof LexPrepProgress === 'undefined' || typeof LEXPREP_DATA === 'undefined') return;
  if (typeof LexPrepProgress.getGamification !== 'function') return;

  const g = LexPrepProgress.getGamification();
  document.getElementById('rankIcon').src = `assets/badges/${g.rankIcon}`;
  document.getElementById('rankLevelNum').textContent = g.level;
  document.getElementById('rankName').textContent = g.rankName;
  document.getElementById('rankFill').style.width = `${g.progressPercent}%`;
  document.getElementById('rankXp').textContent = `${g.xpIntoLevel} / ${g.xpForNextLevel} XP до следующего уровня`;

  const grid = document.getElementById('achvGrid');
  if (!grid) return;

  const achievements = LexPrepProgress.getAchievements(LEXPREP_DATA);

  grid.innerHTML = achievements.categories.map(cat => `
    <div class="achv-category">
      <div class="achv-category__head">
        <div class="achv-category__info">
          <div class="achv-category__title">${escapeAttr(cat.title)}</div>
          <div class="achv-category__desc">${escapeAttr(cat.desc)}</div>
        </div>
        <span class="achv-category__count">${cat.earnedCount}/${cat.total}</span>
      </div>
      <div class="achv-category__list">
        ${cat.items.map(item => `
          <div class="achv-item ${item.earned ? 'is-earned' : ''}">
            <span class="achv-item__icon">
              ${item.earned
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'}
            </span>
            <div>
              <div class="achv-item__title">${escapeAttr(item.title)}</div>
              ${item.desc ? `<div class="achv-item__desc">${escapeAttr(item.desc)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function escapeAttr(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- Theme switch (single source of truth for the whole site) ---------------- */
function initThemeSwitch() {
  const toggle = document.getElementById('themeSwitch');
  const root = document.documentElement;

  function syncSwitch() {
    const isDark = root.getAttribute('data-theme') === 'dark';
    toggle.classList.toggle('is-on', isDark);
    toggle.setAttribute('aria-checked', String(isDark));
  }

  toggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('lexprep-theme', next);
    syncSwitch();
  });

  syncSwitch();
}

/* ---------------- Notifications switch (demo setting) ---------------- */
function initNotificationsSwitch() {
  const toggle = document.getElementById('notificationsSwitch');

  function syncSwitch() {
    const enabled = localStorage.getItem('lexprep_notifications') !== '0';
    toggle.classList.toggle('is-on', enabled);
    toggle.setAttribute('aria-checked', String(enabled));
  }

  toggle.addEventListener('click', () => {
    const enabled = localStorage.getItem('lexprep_notifications') !== '0';
    localStorage.setItem('lexprep_notifications', enabled ? '0' : '1');
    syncSwitch();
  });

  syncSwitch();
}

/* ---------------- My articles ---------------- */
function getUserArticles() {
  return JSON.parse(localStorage.getItem('lexprep_user_articles') || '[]');
}

function initMyArticles() {
  const list = document.getElementById('myArticlesList');
  if (!list) return;

  function render() {
    const articles = getUserArticles();

    if (!articles.length) {
      list.innerHTML = '<p class="topic-desc">Ты ещё не опубликовал(а) ни одной статьи.</p>';
      return;
    }

    list.innerHTML = articles.map(article => `
      <div class="my-article-item" data-article-id="${article.id}">
        <div class="my-article-item__main">
          <div class="my-article-item__top">
            <span class="my-article-item__tag">${escapeAttr(article.tag || '')}</span>
            <span class="my-article-item__date">${escapeAttr(article.date || '')}</span>
          </div>
          <span class="my-article-item__title">${escapeAttr(article.title || '')}</span>
        </div>
        <button class="btn btn--outline my-article-item__delete" type="button" data-delete-id="${article.id}">Удалить</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-delete-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.deleteId);
        const confirmed = window.confirm('Удалить эту статью? Действие нельзя отменить.');
        if (!confirmed) return;
        const remaining = getUserArticles().filter(a => a.id !== id);
        localStorage.setItem('lexprep_user_articles', JSON.stringify(remaining));
        render();
      });
    });
  }

  render();
}

/* ---------------- Referral program (demo: link + promo code only, rewards TBD with backend) ---------------- */
function getReferralCode() {
  let code = localStorage.getItem('lexprep_referral_code');
  if (!code) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    code = `LEX-${suffix}`;
    localStorage.setItem('lexprep_referral_code', code);
  }
  return code;
}

function initReferral() {
  const linkEl = document.getElementById('referralLink');
  const codeEl = document.getElementById('referralCode');
  const status = document.getElementById('referralCopyStatus');
  if (!linkEl || !codeEl) return;

  const code = getReferralCode();
  const basePath = window.location.pathname.replace(/profile\.html$/, '');
  const link = `${window.location.origin}${basePath}auth.html?ref=${code}`;

  linkEl.textContent = link;
  codeEl.textContent = code;

  document.querySelectorAll('[data-copy-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.copyTarget);
      if (!target) return;
      navigator.clipboard.writeText(target.textContent).then(() => {
        status.textContent = 'Скопировано в буфер обмена.';
        setTimeout(() => { status.textContent = ''; }, 2500);
      }).catch(() => {
        status.textContent = 'Не удалось скопировать — выдели и скопируй вручную.';
      });
    });
  });
}

/* ---------------- Password change (demo: nothing is stored, only validated) ---------------- */
function initPasswordForm() {
  const form = document.getElementById('passwordForm');
  if (!form) return;

  const currentInput = document.getElementById('currentPassword');
  const newInput = document.getElementById('newPassword');
  const confirmInput = document.getElementById('newPasswordConfirm');
  const rulesList = document.getElementById('newPasswordRules');
  const success = document.getElementById('passwordSuccess');

  newInput.addEventListener('input', () => {
    const status = getPasswordRuleStatus(newInput.value);
    rulesList.querySelectorAll('[data-rule]').forEach(item => {
      item.classList.toggle('is-met', !!status[item.dataset.rule]);
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    success.classList.remove('is-visible');

    if (!currentInput.value) {
      markFieldInvalid(currentInput, 'Введи текущий пароль.');
      currentInput.focus();
      return;
    }
    clearFieldInvalid(currentInput);

    if (!isPasswordValid(newInput.value)) {
      markFieldInvalid(newInput, 'Пароль не соответствует требованиям выше.');
      newInput.focus();
      return;
    }
    clearFieldInvalid(newInput);

    if (newInput.value !== confirmInput.value) {
      markFieldInvalid(confirmInput, 'Пароли не совпадают.');
      confirmInput.focus();
      return;
    }
    clearFieldInvalid(confirmInput);

    form.reset();
    rulesList.querySelectorAll('[data-rule]').forEach(item => item.classList.remove('is-met'));
    success.classList.add('is-visible');
    setTimeout(() => success.classList.remove('is-visible'), 3000);
  });
}

/* ---------------- Privacy documents modal ---------------- */
const PRIVACY_DOCS = {
  privacy: {
    title: 'Политика конфиденциальности',
    body: `
      <p><strong>Черновик — не является юридически обязывающим документом.</strong> Финальную версию должен утвердить юрист перед публикацией.</p>
      <h4>1. Какие данные собираются</h4>
      <p>В демо-версии продукта все данные (имя, email, аватар, статистика) хранятся только локально в браузере пользователя и никуда не передаются.</p>
      <h4>2. Как данные будут использоваться</h4>
      <p>После подключения бэкенда: для авторизации, сохранения прогресса и работы подписки. Раздел будет дополнен конкретными основаниями обработки данных.</p>
      <h4>3. Права пользователя</h4>
      <p>Запросить удаление аккаунта и всех связанных данных — уже доступно в разделе «Опасная зона».</p>
    `
  },
  terms: {
    title: 'Пользовательское соглашение',
    body: `
      <p><strong>Черновик — не является юридически обязывающим документом.</strong></p>
      <h4>1. Предмет соглашения</h4>
      <p>Использование платформы LexPrep для подготовки к семинарам и экзаменам: конспекты, тесты, карточки, судебная практика.</p>
      <h4>2. Обязанности пользователя</h4>
      <p>Не использовать материалы платформы в противоправных целях, не публиковать заведомо недостоверный контент в разделе статей.</p>
      <h4>3. Ограничение ответственности</h4>
      <p>Материалы носят учебный характер и не являются юридической консультацией.</p>
    `
  },
  offer: {
    title: 'Договор оферты',
    body: `
      <p><strong>Черновик — не является юридически обязывающим документом.</strong></p>
      <h4>1. Предмет оферты</h4>
      <p>Предоставление доступа к платным тарифам LexPrep (Базовый, Про, Максимум) на условиях, указанных на странице тарифов.</p>
      <h4>2. Порядок оплаты и продления</h4>
      <p>Подписка продлевается автоматически до отмены пользователем в разделе «Подписка» личного кабинета.</p>
      <h4>3. Возврат средств</h4>
      <p>Условия возврата будут описаны здесь после подключения реального платёжного провайдера.</p>
    `
  }
};

function initPrivacyModal() {
  const overlay = document.getElementById('docModalOverlay');
  const titleEl = document.getElementById('docModalTitle');
  const bodyEl = document.getElementById('docModalBody');
  const closeBtn = document.getElementById('docModalClose');

  function openModal(key) {
    const doc = PRIVACY_DOCS[key];
    if (!doc) return;
    titleEl.textContent = doc.title;
    bodyEl.innerHTML = doc.body;
    overlay.hidden = false;
  }

  function closeModal() {
    overlay.hidden = true;
  }

  document.querySelectorAll('[data-doc]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.doc));
  });

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeModal();
  });
}

/* ---------------- Danger zone ---------------- */
function initDangerZone() {
  const deleteBtn = document.getElementById('deleteAccountBtn');
  deleteBtn.addEventListener('click', () => {
    const confirmed = window.confirm('Удалить аккаунт и все локальные данные демо-профиля? Это действие необратимо.');
    if (!confirmed) return;
    ['lexprep_user', 'lexprep_payment', 'lexprep_sub_cancelled', 'lexprep_notifications'].forEach(key => {
      localStorage.removeItem(key);
    });
    window.location.href = 'index.html';
  });
}
