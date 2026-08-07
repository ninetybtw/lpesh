/* ==========================================================================
WRITE-ARTICLE.JS — форма публикации новой статьи (демо: сохраняется только
в localStorage этого браузера, без реальной модерации и бэкенда)
========================================================================== */

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const TOPIC_LABELS = {
  exam: 'Экзамен',
  practice: 'Практика ВС РФ',
  cases: 'Казусы',
  notes: 'Шпаргалки'
};

function formatArticleDate(date) {
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
}

function estimateReadTime(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 180));
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

  const authorName = document.getElementById('authorName');
  const authorAvatar = document.getElementById('authorAvatar');
  authorName.textContent = user.name || 'Профиль';
  if (user.avatar) {
    authorAvatar.textContent = '';
    authorAvatar.style.backgroundImage = `url(${user.avatar})`;
  } else {
    authorAvatar.textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
  }

  const form = document.getElementById('articleForm');
  const titleInput = document.getElementById('articleTitle');
  const topicSelect = document.getElementById('articleTopic');
  const excerptInput = document.getElementById('articleExcerpt');
  const bodyInput = document.getElementById('articleBody');
  const readEstimate = document.getElementById('articleReadEstimate');
  const counter = document.getElementById('bodyCounter');

  bodyInput.addEventListener('input', () => {
    const length = bodyInput.textContent.length;
    counter.textContent = `${length} символов`;
    counter.classList.toggle('is-ok', length >= 100);
    readEstimate.value = `~${estimateReadTime(bodyInput.textContent)} мин чтения`;
  });

  initEditorToolbar(bodyInput);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let valid = true;

    if (titleInput.value.trim().length < 10) {
      markFieldInvalid(titleInput, 'Заголовок должен быть не короче 10 символов.');
      valid = false;
    } else {
      clearFieldInvalid(titleInput);
    }

    if (!topicSelect.value) {
      markFieldInvalid(topicSelect, 'Выбери раздел для статьи.');
      valid = false;
    } else {
      clearFieldInvalid(topicSelect);
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
      form.querySelector('.is-invalid')?.focus();
      return;
    }

    const articles = JSON.parse(localStorage.getItem('lexprep_user_articles') || '[]');
    const newArticle = {
      id: Date.now(),
      tag: TOPIC_LABELS[topicSelect.value],
      title: titleInput.value.trim(),
      text: excerptInput.value.trim(),
      body: bodyInput.innerHTML.trim(),
      author: user.name || 'Аноним',
      date: formatArticleDate(new Date()),
      likes: 0,
      readTime: estimateReadTime(bodyInput.textContent),
      liked: false,
      read: false,
      saved: false,
      topic: topicSelect.value
    };

    articles.unshift(newArticle);
    localStorage.setItem('lexprep_user_articles', JSON.stringify(articles));

    window.location.href = 'article.html';
  });
});
