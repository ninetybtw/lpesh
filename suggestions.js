/* ---------------- Предложения (suggestions.html) ---------------- */

const SUGGESTION_STATUS_LABEL = {
  new: 'Новое',
  reviewing: 'На рассмотрении',
  accepted: 'Принято',
  rejected: 'Отклонено'
};

function formatSuggestionDate(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function escapeHtmlS(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function renderSuggestions(list, suggestions) {
  if (!suggestions.length) {
    list.innerHTML = '<p class="community-empty">Предложений пока нет — предложи первое.</p>';
    return;
  }
  list.innerHTML = suggestions.map(s => `
    <div class="community-item" data-suggestion-id="${s.id}">
      <div class="community-item__head">
        <h3>${escapeHtmlS(s.title)}</h3>
        <span class="community-badge community-badge--${s.status}">${SUGGESTION_STATUS_LABEL[s.status] || s.status}</span>
      </div>
      <p class="community-item__message">${escapeHtmlS(s.message)}</p>
      <div class="community-item__meta">
        <span>${formatSuggestionDate(s.createdAt)}</span>
        <button type="button" class="community-vote${s.votedByMe ? ' community-vote--active' : ''}" data-vote-btn>
          ▲ <span data-vote-count>${s.votes}</span>
        </button>
      </div>
      ${s.adminComment ? `
        <div class="community-item__reply">
          <div class="community-item__reply-label">Комментарий команды</div>
          <p>${escapeHtmlS(s.adminComment)}</p>
        </div>` : ''}
    </div>
  `).join('');

  list.querySelectorAll('[data-vote-btn]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.closest('[data-suggestion-id]');
      const id = item.dataset.suggestionId;
      const countEl = btn.querySelector('[data-vote-count]');
      const active = btn.classList.contains('community-vote--active');
      btn.disabled = true;
      try {
        if (active) {
          await LexPrepApi.unvoteSuggestion(id);
          btn.classList.remove('community-vote--active');
          countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) - 1);
        } else {
          await LexPrepApi.voteSuggestion(id);
          btn.classList.add('community-vote--active');
          countEl.textContent = parseInt(countEl.textContent, 10) + 1;
        }
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('suggestionForm');
  const list = document.getElementById('suggestionList');
  const status = document.getElementById('suggestionFormStatus');
  const submitBtn = document.getElementById('suggestionSubmit');
  if (!list) return;

  async function loadSuggestions() {
    if (typeof LexPrepApi === 'undefined') return;
    try {
      const suggestions = await LexPrepApi.listSuggestions();
      renderSuggestions(list, suggestions);
    } catch (err) {
      if (err.status !== 401) {
        list.innerHTML = '<p class="community-empty">Не удалось загрузить предложения — попробуй обновить страницу.</p>';
      }
    }
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('suggestionTitle').value.trim();
      const message = document.getElementById('suggestionMessage').value.trim();
      if (!title || !message) return;

      submitBtn.disabled = true;
      status.dataset.error = 'false';
      status.textContent = 'Отправляем…';
      try {
        await LexPrepApi.createSuggestion({ title, message });
        form.reset();
        status.textContent = 'Предложение отправлено.';
        setTimeout(() => { status.textContent = ''; }, 2500);
        await loadSuggestions();
      } catch (err) {
        status.dataset.error = 'true';
        status.textContent = err.message;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  loadSuggestions();
});
