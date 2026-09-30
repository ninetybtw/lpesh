/* ---------------- Предложения (/suggestions) ----------------
   Доска идей: список предложений всех пользователей с голосованием
   (LexPrepApi.listSuggestions / voteSuggestion / unvoteSuggestion).
   Сортировка и фильтр по статусу — на клиенте. */

const SUGGESTION_STATUS_LABEL = {
  new: 'Новое',
  reviewing: 'На рассмотрении',
  accepted: 'Принято',
  rejected: 'Отклонено'
};

function formatSuggestionDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return '';
  }
}

function escapeHtmlS(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('suggestionForm');
  const list = document.getElementById('suggestionList');
  const status = document.getElementById('suggestionFormStatus');
  const submitBtn = document.getElementById('suggestionSubmit');
  const filterEl = document.getElementById('suggestionFilter');
  const statsEl = document.getElementById('ideaStats');
  if (!list) return;

  let me = null;
  try { me = JSON.parse(localStorage.getItem('lexprep_user') || 'null'); } catch (e) { me = null; }

  let suggestions = [];
  let filter = 'all';
  let sort = 'top';

  function itemHtml(s) {
    const mine = me && s.userId && s.userId === me.id;
    const long = (s.message || '').length > 260;
    return `
      <article class="help-idea help-item--${escapeHtmlS(s.status)} ${s.votedByMe ? 'is-voted' : ''}" data-suggestion-id="${escapeHtmlS(s.id)}">
        <button type="button" class="help-vote ${s.votedByMe ? 'is-active' : ''}" data-vote-btn aria-pressed="${s.votedByMe ? 'true' : 'false'}" aria-label="${s.votedByMe ? 'Убрать голос' : 'Поддержать идею'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>
          <b data-vote-count>${s.votes}</b>
        </button>
        <div class="help-idea__body">
          <div class="help-item__head">
            <h3>${escapeHtmlS(s.title)}</h3>
            <span class="help-badge help-badge--${escapeHtmlS(s.status)}">${SUGGESTION_STATUS_LABEL[s.status] || escapeHtmlS(s.status)}</span>
          </div>
          <div class="help-item__meta">
            ${formatSuggestionDate(s.createdAt)}
            ${mine ? '<span class="help-mine">твоя идея</span>' : ''}
          </div>
          <p class="help-item__message ${long ? 'is-clamped' : ''}">${escapeHtmlS(s.message)}</p>
          ${long ? '<button type="button" class="help-more" data-more>Показать полностью</button>' : ''}
          ${s.adminComment ? `
            <div class="help-reply">
              <span class="help-reply__avatar" aria-hidden="true"><img src="assets/favicon/apple-touch-icon.png" alt="" /></span>
              <div class="help-reply__bubble">
                <span class="help-reply__label">Комментарий команды</span>
                <p>${escapeHtmlS(s.adminComment)}</p>
              </div>
            </div>` : ''}
        </div>
      </article>
    `;
  }

  function renderStats() {
    const counts = { all: suggestions.length, new: 0, reviewing: 0, accepted: 0, rejected: 0 };
    suggestions.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });
    if (filterEl) {
      filterEl.querySelectorAll('[data-count]').forEach(el => {
        const n = counts[el.dataset.count];
        el.textContent = n ? n : '';
      });
    }
    if (statsEl) {
      statsEl.hidden = !suggestions.length;
      const set = (key, value) => {
        const el = statsEl.querySelector(`[data-stat="${key}"]`);
        if (!el) return;
        if (window.LexPrepMotion) LexPrepMotion.countTo(el, value, 700);
        else el.textContent = value;
      };
      set('total', counts.all);
      set('reviewing', counts.reviewing);
      set('accepted', counts.accepted);
    }
  }

  function renderSuggestions(animate) {
    renderStats();
    if (!suggestions.length) {
      list.innerHTML = `
        <div class="help-empty help-empty--big">
          <img class="lp-icon" src="assets/icons/lightbulb.svg" alt="" />
          <b>Идей пока нет</b>
          <span>Предложи первую — остальные смогут за неё проголосовать.</span>
        </div>`;
      return;
    }
    let shown = filter === 'all' ? suggestions.slice() : suggestions.filter(s => s.status === filter);
    shown.sort(sort === 'top'
      ? (a, b) => b.votes - a.votes || new Date(b.createdAt) - new Date(a.createdAt)
      : (a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    list.innerHTML = shown.length
      ? shown.map(itemHtml).join('')
      : '<p class="help-empty">В этом разделе пока пусто.</p>';
    if (animate !== false && window.LexPrepMotion) LexPrepMotion.stagger(list, '.help-idea', 60);
  }

  list.addEventListener('click', async (e) => {
    const more = e.target.closest('[data-more]');
    if (more) {
      const message = more.previousElementSibling;
      const clamped = message.classList.toggle('is-clamped');
      more.textContent = clamped ? 'Показать полностью' : 'Свернуть';
      return;
    }

    const btn = e.target.closest('[data-vote-btn]');
    if (!btn) return;
    const item = btn.closest('[data-suggestion-id]');
    const id = item.dataset.suggestionId;
    const suggestion = suggestions.find(s => String(s.id) === id);
    const countEl = btn.querySelector('[data-vote-count]');
    const active = btn.classList.contains('is-active');
    btn.disabled = true;
    try {
      if (active) {
        await LexPrepApi.unvoteSuggestion(id);
      } else {
        await LexPrepApi.voteSuggestion(id);
      }
      const votes = active ? Math.max(0, parseInt(countEl.textContent, 10) - 1) : parseInt(countEl.textContent, 10) + 1;
      if (suggestion) {
        suggestion.votes = votes;
        suggestion.votedByMe = !active;
      }
      // Без полной перерисовки — чтобы карточка не прыгала при сортировке
      // «Популярные»; порядок обновится при следующем выборе сортировки.
      countEl.textContent = votes;
      btn.classList.toggle('is-active', !active);
      item.classList.toggle('is-voted', !active);
      btn.setAttribute('aria-pressed', String(!active));
      btn.setAttribute('aria-label', !active ? 'Убрать голос' : 'Поддержать идею');
      btn.classList.remove('is-bump');
      void btn.offsetWidth;
      btn.classList.add('is-bump');
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  if (filterEl) {
    filterEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      filter = btn.dataset.filter;
      filterEl.querySelectorAll('[data-filter]').forEach(b => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      renderSuggestions();
    });
  }

  document.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      sort = btn.dataset.sort;
      document.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('is-active', b === btn));
      renderSuggestions();
    });
  });

  async function loadSuggestions() {
    if (typeof LexPrepApi === 'undefined') return;
    try {
      suggestions = await LexPrepApi.listSuggestions();
      renderSuggestions();
    } catch (err) {
      if (err.status !== 401) {
        list.innerHTML = '<p class="help-empty">Не удалось загрузить предложения — попробуй обновить страницу.</p>';
      }
    }
  }

  // Счётчики символов.
  [['suggestionTitle', 'suggestionTitleCount'], ['suggestionMessage', 'suggestionMessageCount']].forEach(([inputId, countId]) => {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(countId);
    if (!input || !counter) return;
    const update = () => { counter.textContent = input.value.length; };
    input.addEventListener('input', update);
    update();
  });

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleInput = document.getElementById('suggestionTitle');
      const messageInput = document.getElementById('suggestionMessage');
      const title = titleInput.value.trim();
      const message = messageInput.value.trim();
      if (!title || !message) return;

      submitBtn.disabled = true;
      status.dataset.error = 'false';
      status.textContent = 'Отправляем…';
      try {
        await LexPrepApi.createSuggestion({ title, message });
        form.reset();
        titleInput.dispatchEvent(new Event('input'));
        messageInput.dispatchEvent(new Event('input'));
        status.dataset.error = 'false';
        status.textContent = 'Идея отправлена — спасибо!';
        form.classList.remove('is-sent');
        void form.offsetWidth;
        form.classList.add('is-sent');
        setTimeout(() => { status.textContent = ''; }, 3500);
        // Новую идею показываем сразу: сортировка «Новые», фильтр «Все».
        sort = 'new';
        filter = 'all';
        document.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('is-active', b.dataset.sort === 'new'));
        if (filterEl) filterEl.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('is-active', b.dataset.filter === 'all'));
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
