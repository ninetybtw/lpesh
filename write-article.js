/* ==========================================================================
WRITE-ARTICLE.JS — форма публикации новой статьи. Отправляется в
public.user_articles со статусом pending — виден в общем каталоге только
после одобрения модератором/админом (см. moderator.js, api.js). Доступно
только на тарифах «Про»/«Максимум».
========================================================================== */

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

  if (typeof LexPrepPlan !== 'undefined' && LexPrepPlan.getTier() === 'basic' && !user.isAdmin) {
    document.getElementById('waBasicGuard').hidden = false;
    document.getElementById('waFormWrap').hidden = true;
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

    const submitBtn = form.querySelector('button[type="submit"]');
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

      alert('Статья отправлена на модерацию — как только её одобрят, она появится в общем каталоге.');
      window.location.href = 'article.html';
    } catch (err) {
      alert('Не удалось отправить статью: ' + err.message);
      submitBtn.disabled = false;
    }
  });
});
