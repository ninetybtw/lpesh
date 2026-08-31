/* ==========================================================================
PROFILE.JS — личный кабинет: навигация по разделам, редактирование профиля,
подписка, статистика (демо), настройки и переключатель темы
========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
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
  initMyArticles();
  initReferral();
  initThemeSwitch();
  initNotificationsSwitch();
  initPasswordForm();
  initPrivacyModal();
  initDangerZone();

  // Статистика/достижения и выбор дисциплины опираются на LEXPREP_DATA —
  // до подгрузки реального контента из Supabase это demo-заглушка
  // (без неё "Последние тесты" не находили тему и показывали id/заглушку).
  await (window.LexPrepContentReady || Promise.resolve());
  initStats();
  initGamification();
  initBasicDisciplineSetting();
  initMyTests();
});

function getUser() {
  return JSON.parse(localStorage.getItem('lexprep_user') || 'null') || {};
}

function saveUser(patch) {
  const user = { ...getUser(), ...patch };
  localStorage.setItem('lexprep_user', JSON.stringify(user));

  // Бэкенд пока хранит только имя и аватар — остальные поля формы
  // (university, course, email) остаются локальными до отдельного шага.
  const backendPatch = {};
  if ('name' in patch) backendPatch.name = patch.name;
  if ('avatar' in patch) backendPatch.avatar = patch.avatar || null;
  if (Object.keys(backendPatch).length && typeof LexPrepApi !== 'undefined') {
    LexPrepApi.updateProfile(backendPatch).catch(err => {
      console.error('Не удалось сохранить изменения профиля на сервере:', err.message);
    });
  }

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
const PLAN_PRICES = { basic: 'Бесплатно', pro: '700 ₽ / мес', max: '1500 ₽ / мес' };
const PLAN_FEATURES = {
  basic: ['1 дисциплина полностью открыта', '15 карточек в день', '1 попытка теста в день, без разбора', 'Нельзя публиковать свои тесты и статьи'],
  pro: ['Все конспекты и карточки без ограничений', '5 попыток теста в день с разбором', 'Пробный экзамен — 3 попытки в месяц', 'ИИ-консультант, дуэли — 3/день, турниры — 1/мес', 'Публикация своих тестов и статей (после модерации)'],
  max: ['Всё из «Про» без лимитов', 'ИИ-консультант — 35 запросов в день', 'Безлимит: пробные экзамены, дуэли, турниры', 'Экспорт конспектов в PDF']
};

function initSubscription() {
  const cancelBtn = document.getElementById('cancelSubBtn');
  const note = document.getElementById('planNote');
  const badge = document.getElementById('planBadge');
  const priceEl = document.getElementById('planPrice');
  const renewalEl = document.getElementById('planRenewal');
  const listEl = document.querySelector('.plan-box__list');

  if (typeof LexPrepPlan === 'undefined') return;
  const { tier, expires } = LexPrepPlan.getEffectivePlan();
  const title = LexPrepPlan.TIER_TITLES[tier];

  badge.textContent = `Тариф «${title}»`;
  priceEl.textContent = PLAN_PRICES[tier];
  listEl.innerHTML = PLAN_FEATURES[tier].map(f => `<li>${f}</li>`).join('');

  if (tier === 'basic') {
    renewalEl.textContent = 'Бесплатный тариф — можно оформить платный в любой момент.';
    cancelBtn.hidden = true;
    note.hidden = true;
    return;
  }

  cancelBtn.hidden = false;
  const renewalDate = new Date(expires).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  function applyState() {
    const cancelled = localStorage.getItem('lexprep_sub_cancelled') === '1';
    note.hidden = !cancelled;
    if (cancelled) note.textContent = `Подписка отменена. Доступ к тарифу «${title}» сохранится до конца оплаченного периода — ${renewalDate}.`;
    cancelBtn.textContent = cancelled ? 'Возобновить подписку' : 'Отменить подписку';
    renewalEl.textContent = `Следующее списание: ${renewalDate}`;
  }

  cancelBtn.addEventListener('click', () => {
    const cancelled = localStorage.getItem('lexprep_sub_cancelled') === '1';
    if (!cancelled) {
      const confirmed = window.confirm(`Отменить подписку? Доступ к тарифу «${title}» сохранится до конца оплаченного периода.`);
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
      <button class="achv-category__head" type="button" data-category-toggle="${cat.id}" aria-expanded="false">
        <div class="achv-category__info">
          <div class="achv-category__title">${escapeAttr(cat.title)}</div>
          <div class="achv-category__desc">${escapeAttr(cat.desc)}</div>
        </div>
        <span class="achv-category__count">${cat.earnedCount}/${cat.total}</span>
      </button>
      <div class="achv-category__list" id="achvList-${cat.id}">
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

  grid.querySelectorAll('[data-category-toggle]').forEach(btn => {
    const list = document.getElementById(`achvList-${btn.dataset.categoryToggle}`);
    if (!list) return;
    btn.addEventListener('click', () => {
      const isOpen = btn.classList.contains('is-open');
      if (isOpen) {
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        list.style.maxHeight = null;
      } else {
        btn.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        list.style.maxHeight = list.scrollHeight + 'px';
      }
    });
  });
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

/* ---------------- Discipline choice for the Basic tier ---------------- */
function initBasicDisciplineSetting() {
  const select = document.getElementById('basicDisciplineSelect');
  if (!select || typeof LEXPREP_DATA === 'undefined' || typeof LexPrepPlan === 'undefined') return;

  select.innerHTML = LEXPREP_DATA.map(d => `<option value="${d.id}">${d.title}</option>`).join('');
  select.value = LexPrepPlan.getChosenDisciplineId(LEXPREP_DATA);

  select.addEventListener('change', () => {
    LexPrepPlan.setChosenDisciplineId(select.value);
  });
}

/* ---------------- Мои статьи / мои тесты (с модерацией) ----------------
   Раньше публиковались сразу в localStorage этого браузера, теперь идут
   через public.user_articles/public.user_tests (см. moderator.js) —
   отправленное здесь может быть на модерации, отклонено (с комментарием
   модератора) или уже опубликовано и видно всем. */

const MY_CONTENT_STATUS_LABEL = { pending: 'На модерации', published: 'Опубликован(а)', rejected: 'Отклонён(а)' };

function formatMyContentDate(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function initMyArticles() {
  const list = document.getElementById('myArticlesList');
  if (!list || typeof LexPrepApi === 'undefined') return;

  async function render() {
    list.innerHTML = '<p class="topic-desc">Загрузка…</p>';
    let articles;
    try {
      articles = await LexPrepApi.listMyUserArticles();
    } catch (err) {
      list.innerHTML = `<p class="topic-desc">Не удалось загрузить: ${escapeAttr(err.message)}</p>`;
      return;
    }

    if (!articles.length) {
      list.innerHTML = '<p class="topic-desc">Ты ещё не опубликовал(а) ни одной статьи.</p>';
      return;
    }

    list.innerHTML = articles.map(article => `
      <div class="my-article-item" data-article-id="${article.id}">
        <div class="my-article-item__main">
          <div class="my-article-item__top">
            <span class="my-article-item__tag">${escapeAttr(MY_CONTENT_STATUS_LABEL[article.status] || article.status)}</span>
            <span class="my-article-item__date">${escapeAttr(formatMyContentDate(article.createdAt))}</span>
          </div>
          <span class="my-article-item__title">${escapeAttr(article.title || '')}</span>
          ${article.status === 'rejected' && article.moderatorComment ? `<span class="my-article-item__date">Причина: ${escapeAttr(article.moderatorComment)}</span>` : ''}
        </div>
        <button class="btn btn--outline my-article-item__delete" type="button" data-delete-id="${article.id}">Удалить</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-delete-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteId;
        if (!window.confirm('Удалить эту статью? Действие нельзя отменить.')) return;
        try {
          await LexPrepApi.deleteUserArticle(id);
          render();
        } catch (err) {
          alert('Не удалось удалить: ' + err.message);
        }
      });
    });
  }

  render();
}

function initMyTests() {
  const list = document.getElementById('myTestsList');
  if (!list || typeof LexPrepApi === 'undefined') return;

  const DATA = typeof LEXPREP_DATA !== 'undefined' ? LEXPREP_DATA : [];
  function topicTitle(disciplineId, topicId) {
    const d = DATA.find(x => x.id === disciplineId);
    const t = d && d.topics.find(x => x.id === topicId);
    return t ? t.title : topicId;
  }

  async function render() {
    list.innerHTML = '<p class="topic-desc">Загрузка…</p>';
    let tests;
    try {
      tests = await LexPrepApi.listMyUserTests();
    } catch (err) {
      list.innerHTML = `<p class="topic-desc">Не удалось загрузить: ${escapeAttr(err.message)}</p>`;
      return;
    }

    if (!tests.length) {
      list.innerHTML = '<p class="topic-desc">Ты ещё не отправил(а) ни одного теста на модерацию.</p>';
      return;
    }

    list.innerHTML = tests.map(test => `
      <div class="my-article-item" data-test-id="${test.id}">
        <div class="my-article-item__main">
          <div class="my-article-item__top">
            <span class="my-article-item__tag">${escapeAttr(MY_CONTENT_STATUS_LABEL[test.status] || test.status)}</span>
            <span class="my-article-item__date">${escapeAttr(formatMyContentDate(test.createdAt))} · ${test.questions.length} вопросов</span>
          </div>
          <span class="my-article-item__title">${escapeAttr(test.title)} — ${escapeAttr(topicTitle(test.disciplineId, test.topicId))}</span>
          ${test.status === 'rejected' && test.moderatorComment ? `<span class="my-article-item__date">Причина: ${escapeAttr(test.moderatorComment)}</span>` : ''}
        </div>
        <button class="btn btn--outline my-article-item__delete" type="button" data-delete-id="${test.id}">Удалить</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-delete-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteId;
        if (!window.confirm('Удалить этот тест? Действие нельзя отменить.')) return;
        try {
          await LexPrepApi.deleteUserTest(id);
          render();
        } catch (err) {
          alert('Не удалось удалить: ' + err.message);
        }
      });
    });
  }

  render();
}

/* ---------------- Referral program (код реальный, из profiles.referral_code;
   начисление наград за приглашение всё ещё не реализовано) ---------------- */
function buildReferralLink(code) {
  const basePath = window.location.pathname.replace(/profile\.html$/, '');
  return `${window.location.origin}${basePath}auth.html?ref=${code}`;
}

function initReferral() {
  const linkEl = document.getElementById('referralLink');
  const codeEl = document.getElementById('referralCode');
  const editBtn = document.getElementById('referralEditBtn');
  const status = document.getElementById('referralCopyStatus');
  if (!linkEl || !codeEl) return;

  function render() {
    const code = getUser().referralCode || '—';
    linkEl.textContent = buildReferralLink(code);
    codeEl.textContent = code;
  }
  render();

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

  if (editBtn) {
    editBtn.addEventListener('click', async () => {
      const current = getUser().referralCode || '';
      const next = prompt('Свой промокод (3–20 символов: латинские буквы, цифры, дефис):', current);
      if (next === null) return;
      const normalized = next.trim().toUpperCase();
      if (!normalized || normalized === current) return;

      if (typeof LexPrepApi === 'undefined') {
        status.textContent = 'Нет соединения с сервером — попробуй позже.';
        return;
      }

      editBtn.disabled = true;
      try {
        const updated = await LexPrepApi.updateProfile({ referralCode: normalized });
        saveUser({ referralCode: updated.referralCode });
        render();
        status.textContent = 'Промокод обновлён.';
        setTimeout(() => { status.textContent = ''; }, 2500);
      } catch (err) {
        status.textContent = err.message;
      } finally {
        editBtn.disabled = false;
      }
    });
  }
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

/* ---------------- Privacy documents modal ----------------
   Тексты документов — в legal-docs.js (LEXPREP_LEGAL_DOCS), тем же
   markdown-форматом, что и конспекты; рендерятся через marked.parse(). */

function initPrivacyModal() {
  const overlay = document.getElementById('docModalOverlay');
  const titleEl = document.getElementById('docModalTitle');
  const bodyEl = document.getElementById('docModalBody');
  const closeBtn = document.getElementById('docModalClose');

  function openModal(key) {
    const doc = LEXPREP_LEGAL_DOCS[key];
    if (!doc) return;
    titleEl.textContent = doc.title;
    bodyEl.innerHTML = typeof marked !== 'undefined' ? marked.parse(doc.markdown) : `<pre>${doc.markdown}</pre>`;
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
// Настоящее удаление учётной записи в Supabase требует service_role
// (Edge Function) — с одним anon-ключом на фронтенде пользователь не
// может удалить сам себя из auth.users. Это отдельный следующий шаг;
// пока кнопка честно только выходит из аккаунта и чистит локальные
// данные, не обещая того, чего ещё не умеет.
function initDangerZone() {
  const deleteBtn = document.getElementById('deleteAccountBtn');
  deleteBtn.addEventListener('click', async () => {
    const confirmed = window.confirm('Выйти из аккаунта и стереть локальный прогресс в этом браузере? Сама учётная запись (email и пароль) пока останется — удаление аккаунта на сервере появится отдельным шагом.');
    if (!confirmed) return;

    deleteBtn.disabled = true;
    try {
      if (typeof LexPrepApi !== 'undefined') {
        await LexPrepApi.logout();
      }
    } catch (err) {
      console.error('Не удалось завершить сессию на сервере:', err.message);
    }

    Object.keys(localStorage)
      .filter(key => key.startsWith('lexprep_'))
      .forEach(key => localStorage.removeItem(key));
    window.location.href = 'index.html';
  });
}
