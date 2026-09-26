/* ==========================================================================
WRITE-ARTICLE.JS — форма публикации новой статьи. Отправляется в
public.user_articles со статусом pending — виден в общем каталоге только
после одобрения модератором/админом (см. moderator.js, api.js). Доступно
только на тарифах «Про»/«Максимум».
Черновик сохраняется в этом браузере, пока статья не отправлена.
========================================================================== */

const ARTICLE_DRAFT_KEY = 'lexprep_article_draft';

function estimateReadTime(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 180));
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// «1 слово», «3 слова», «12 слов».
function pluralRu(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function initEditorToolbar(editor) {
  const buttons = document.querySelectorAll('.editor-toolbar__btn');

  function syncActiveStates() {
    buttons.forEach(btn => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'formatBlock' || cmd === 'removeFormat') return;
      let isActive = false;
      try {
        isActive = document.queryCommandState(cmd);
      } catch (e) {
        isActive = false;
      }
      btn.classList.toggle('is-active', isActive);
    });
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      editor.focus();
      const cmd = btn.dataset.cmd;
      const value = btn.dataset.value || undefined;
      document.execCommand(cmd, false, value);
      syncActiveStates();
      editor.dispatchEvent(new Event('input'));
    });
  });

  editor.addEventListener('keyup', syncActiveStates);
  editor.addEventListener('mouseup', syncActiveStates);
  editor.addEventListener('focus', syncActiveStates);
}

document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }

  if (typeof LexPrepPlan !== 'undefined' && LexPrepPlan.getTier() === 'basic' && !user.isAdmin) {
    document.getElementById('waBasicGuard').hidden = false;
    document.getElementById('waFormWrap').hidden = true;
    return;
  }

  const initial = (user.name || 'U').trim().charAt(0).toUpperCase();
  const authorName = document.getElementById('authorName');
  const authorAvatar = document.getElementById('authorAvatar');
  const previewAvatar = document.getElementById('previewAvatar');
  authorName.textContent = user.name || 'Профиль';
  document.getElementById('previewAuthor').textContent = user.name || 'Автор';
  [authorAvatar, previewAvatar].forEach(el => {
    if (user.avatar) {
      el.textContent = '';
      el.style.backgroundImage = `url(${user.avatar})`;
    } else {
      el.textContent = initial;
    }
  });

  const form = document.getElementById('articleForm');
  const titleInput = document.getElementById('articleTitle');
  const topicSelect = document.getElementById('articleTopic');
  const topicChips = document.getElementById('articleTopicChips');
  const excerptInput = document.getElementById('articleExcerpt');
  const bodyInput = document.getElementById('articleBody');
  const readEstimate = document.getElementById('articleReadEstimate');
  const counter = document.getElementById('bodyCounter');
  const wordCounter = document.getElementById('wordCounter');
  const draftStatus = document.getElementById('draftStatus');

  const TOPIC_TITLES = { exam: 'Экзамен', practice: 'Практика ВС РФ', cases: 'Казусы', notes: 'Шпаргалки' };

  // Заголовок — многострочное поле, растущее по тексту (без переносов строк).
  function autosizeTitle() {
    titleInput.style.height = 'auto';
    titleInput.style.height = `${titleInput.scrollHeight}px`;
  }
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      excerptInput.focus();
    }
  });

  function setTopic(value) {
    topicSelect.value = value;
    topicChips.querySelectorAll('[data-topic]').forEach(btn => {
      const on = btn.dataset.topic === value;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }
  topicChips.querySelectorAll('[data-topic]').forEach(btn => {
    btn.addEventListener('click', () => {
      setTopic(btn.dataset.topic);
      clearFieldInvalid(topicChips);
      refresh();
    });
  });

  /* ---------- Черновик ---------- */
  let saveTimer = null;
  function saveDraft() {
    const draft = {
      title: titleInput.value,
      topic: topicSelect.value,
      excerpt: excerptInput.value,
      body: bodyInput.innerHTML,
      savedAt: Date.now()
    };
    const empty = !draft.title.trim() && !draft.excerpt.trim() && !bodyInput.textContent.trim() && !draft.topic;
    try {
      if (empty) localStorage.removeItem(ARTICLE_DRAFT_KEY);
      else localStorage.setItem(ARTICLE_DRAFT_KEY, JSON.stringify(draft));
      draftStatus.textContent = empty ? '' : 'Черновик сохранён';
      draftStatus.classList.toggle('is-saved', !empty);
    } catch (e) { /* хранилище недоступно — просто без черновика */ }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    draftStatus.textContent = 'Сохраняем…';
    draftStatus.classList.remove('is-saved');
    saveTimer = setTimeout(saveDraft, 700);
  }
  function restoreDraft() {
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(ARTICLE_DRAFT_KEY) || 'null'); } catch (e) { draft = null; }
    if (!draft) return;
    titleInput.value = draft.title || '';
    excerptInput.value = draft.excerpt || '';
    bodyInput.innerHTML = draft.body || '';
    if (draft.topic) setTopic(draft.topic);
    draftStatus.textContent = 'Черновик восстановлен';
    draftStatus.classList.add('is-saved');
  }

  /* ---------- Счётчики, готовность, превью ---------- */
  const readyList = document.getElementById('readyList');
  function refresh() {
    const text = bodyInput.textContent;
    const length = text.length;
    const words = countWords(text);
    const minutes = estimateReadTime(text);

    counter.textContent = `${length} ${pluralRu(length, 'символ', 'символа', 'символов')}`;
    counter.classList.toggle('is-ok', length >= 100);
    wordCounter.textContent = `${words} ${pluralRu(words, 'слово', 'слова', 'слов')}`;
    readEstimate.textContent = `~${minutes} мин`;
    document.getElementById('titleCounter').textContent = titleInput.value.length;
    document.getElementById('excerptCounter').textContent = excerptInput.value.length;

    const checks = {
      title: titleInput.value.trim().length >= 10,
      topic: !!topicSelect.value,
      excerpt: excerptInput.value.trim().length >= 30,
      body: text.trim().length >= 100
    };
    // Ошибка под полем пропадает, как только поле исправлено.
    if (checks.title) clearFieldInvalid(titleInput);
    if (checks.excerpt) clearFieldInvalid(excerptInput);
    if (checks.body) clearFieldInvalid(bodyInput);

    const done = Object.values(checks).filter(Boolean).length;
    readyList.querySelectorAll('[data-check]').forEach(li => li.classList.toggle('is-done', checks[li.dataset.check]));
    const pct = Math.round((done / 4) * 100);
    document.getElementById('readyPercent').textContent = `${pct}%`;
    document.getElementById('readyBar').style.transform = `scaleX(${done / 4})`;
    form.classList.toggle('is-ready', done === 4);

    document.getElementById('previewTopic').textContent = TOPIC_TITLES[topicSelect.value] || 'Раздел';
    document.getElementById('previewTitle').textContent = titleInput.value.trim() || 'Заголовок статьи';
    document.getElementById('previewExcerpt').textContent = excerptInput.value.trim() || 'Краткое описание появится здесь.';
    document.getElementById('previewRead').textContent = `${minutes} мин`;
  }

  restoreDraft();
  autosizeTitle();
  refresh();

  titleInput.addEventListener('input', () => { autosizeTitle(); refresh(); scheduleSave(); });
  excerptInput.addEventListener('input', () => { refresh(); scheduleSave(); });
  bodyInput.addEventListener('input', () => { refresh(); scheduleSave(); });
  window.addEventListener('resize', autosizeTitle);

  initEditorToolbar(bodyInput);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let valid = true;

    if (titleInput.value.trim().length < 10) {
      markFieldInvalid(titleInput, 'Заголовок должен быть не короче 10 символов.');
      valid = false;
    } else {
      clearFieldInvalid(titleInput);
    }

    if (!topicSelect.value) {
      markFieldInvalid(topicChips, 'Выбери раздел для статьи.');
      valid = false;
    } else {
      clearFieldInvalid(topicChips);
    }

    if (excerptInput.value.trim().length < 30) {
      markFieldInvalid(excerptInput, 'Краткое описание должно быть не короче 30 символов.');
      valid = false;
    } else {
      clearFieldInvalid(excerptInput);
    }

    if (bodyInput.textContent.trim().length < 100) {
      markFieldInvalid(bodyInput, 'Текст статьи должен быть не короче 100 символов.');
      valid = false;
    } else {
      clearFieldInvalid(bodyInput);
    }

    if (!valid) {
      const firstInvalid = form.querySelector('.is-invalid');
      if (firstInvalid) {
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (firstInvalid.matches('input, textarea, [contenteditable]') ? firstInvalid : firstInvalid.querySelector('button'))?.focus({ preventScroll: true });
      }
      return;
    }

    const submitBtn = document.getElementById('articleSubmitBtn');
    submitBtn.disabled = true;

    try {
      await LexPrepApi.createUserArticle({
        topic: topicSelect.value,
        title: titleInput.value.trim(),
        excerpt: excerptInput.value.trim(),
        body: bodyInput.innerHTML.trim(),
        readTime: estimateReadTime(bodyInput.textContent),
        authorName: user.name || 'Аноним'
      });

      clearTimeout(saveTimer);
      try { localStorage.removeItem(ARTICLE_DRAFT_KEY); } catch (err) { /* пусто */ }
      if (window.LexPrepMotion) LexPrepMotion.confetti(submitBtn);
      await LexPrepDialog.alert('Статья отправлена на модерацию — как только её одобрят, она появится в общем каталоге.');
      window.location.href = 'article.html';
    } catch (err) {
      alert('Не удалось отправить статью: ' + err.message);
      submitBtn.disabled = false;
    }
  });
});
