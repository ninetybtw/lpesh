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

const MODERATION_LABELS = { pending: 'На модерации', rejected: 'Отклонена' };

function formatArticleDate(iso) {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
}

// Пользовательские статьи теперь настоящая таблица с модерацией
// (public.user_articles) — опубликованные видят все, свои (любого
// статуса) видит только автор, с пометкой "на модерации"/"отклонена"
// вместо тега раздела. Пока запрос не вернулся, каталог показывает
// только встроенные статьи-примеры ниже.
let userArticles = [];

async function loadUserArticles() {
  if (typeof LexPrepApi === 'undefined') return;
  try {
    const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
    const tasks = [LexPrepApi.listPublishedUserArticles()];
    if (user) tasks.push(LexPrepApi.listMyUserArticles());
    const [published, mine] = await Promise.all(tasks.map(p => p.catch(() => [])));
    const seen = new Set();
    const combined = [];
    (mine || []).forEach(a => { seen.add(a.id); combined.push(a); });
    (published || []).forEach(a => { if (!seen.has(a.id)) combined.push(a); });
    userArticles = combined.map(a => ({
      id: a.id,
      tag: a.status !== 'published' ? (MODERATION_LABELS[a.status] || a.status) : TOPIC_LABELS[a.topic] || a.topic,
      title: a.title,
      text: a.excerpt,
      body: a.body,
      author: a.authorName || 'Аноним',
      date: formatArticleDate(a.createdAt),
      sortTs: new Date(a.createdAt).getTime(),
      likes: 0,
      readTime: a.readTime || 1,
      liked: false,
      saved: false,
      topic: a.topic,
      unplayable: a.status !== 'published'
    }));
  } catch (e) {
    userArticles = [];
  }
}

let articles = [...userArticles];

const state = {
  filter: 'all',
  topic: 'all',
  sort: 'new',
  page: 1,
  perPage: 4
};

const HISTORY_KEY = 'lexprep_article_history';
const HISTORY_LIMIT = 30;

function getHistory() {
  return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
}

function pushHistory(articleId) {
  const history = getHistory().filter(id => id !== articleId);
  history.unshift(articleId);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
}

const grid = document.getElementById('articlesGrid');
const template = document.getElementById('articleCardTemplate');
const statusFilters = document.getElementById('statusFilters');
const topicFilters = document.getElementById('topicFilters');
const sortSelect = document.getElementById('sortSelect');
const writeArticleBtn = document.getElementById('writeArticleBtn');
const pagination = document.getElementById('pagination');
const articlesCountChip = document.getElementById('articlesCountChip');
const articlesPageChip = document.getElementById('articlesPageChip');
const historyList = document.getElementById('historyList');
const historyCard = document.getElementById('historyCard');

function applyFilters(list) {
  const history = getHistory();
  return list.filter(article => {
    const statusMatch =
      state.filter === 'all' ||
      (state.filter === 'liked' && article.liked) ||
      (state.filter === 'saved' && article.saved) ||
      (state.filter === 'history' && history.includes(article.id));

    const topicMatch = state.topic === 'all' || article.topic === state.topic;
    return statusMatch && topicMatch;
  });
}

function applySort(list) {
  const sorted = [...list];

  if (state.filter === 'history') {
    const history = getHistory();
    sorted.sort((a, b) => history.indexOf(a.id) - history.indexOf(b.id));
    return sorted;
  }

  if (state.sort === 'popular') {
    sorted.sort((a, b) => b.likes - a.likes);
  } else if (state.sort === 'readTime') {
    sorted.sort((a, b) => a.readTime - b.readTime);
  } else {
    sorted.sort((a, b) => b.sortTs - a.sortTs);
  }

  return sorted;
}

function paginate(list) {
  const totalPages = Math.max(1, Math.ceil(list.length / state.perPage));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.perPage;
  return {
    items: list.slice(start, start + state.perPage),
    totalPages
  };
}

function renderPagination(totalPages) {
  pagination.innerHTML = '';
  if (totalPages <= 1) return;

  const prev = document.createElement('button');
  prev.className = 'pagination__btn';
  prev.type = 'button';
  prev.textContent = '<';
  prev.disabled = state.page === 1;
  prev.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      renderArticles();
    }
  });
  pagination.appendChild(prev);

  for (let i = 1; i <= totalPages; i += 1) {
    const button = document.createElement('button');
    button.className = `pagination__btn${i === state.page ? ' is-active' : ''}`;
    button.type = 'button';
    button.textContent = String(i);
    button.addEventListener('click', () => {
      state.page = i;
      renderArticles();
    });
    pagination.appendChild(button);
  }

  const next = document.createElement('button');
  next.className = 'pagination__btn';
  next.type = 'button';
  next.textContent = '>';
  next.disabled = state.page === totalPages;
  next.addEventListener('click', () => {
    if (state.page < totalPages) {
      state.page += 1;
      renderArticles();
    }
  });
  pagination.appendChild(next);
}

function renderArticles() {
  const filtered = applySort(applyFilters(articles));
  const { items, totalPages } = paginate(filtered);
  grid.innerHTML = '';

  articlesCountChip.textContent = `${filtered.length} статей`;
  articlesPageChip.textContent = `Страница ${state.page} из ${totalPages}`;

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">По этому фильтру пока нет статей. Сними часть ограничений или открой все статьи.</div>';
    pagination.innerHTML = '';
    return;
  }

  items.forEach(article => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('.article-card');
    const saveButton = fragment.querySelector('.article-card__save');

    fragment.querySelector('.article-card__tag').textContent = article.tag;
    fragment.querySelector('.article-card__title').textContent = article.title;
    fragment.querySelector('.article-card__text').textContent = article.text;
    fragment.querySelector('.article-card__name').textContent = article.author;
    fragment.querySelector('.article-card__date').textContent = article.date;
    fragment.querySelector('.article-card__stats').innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.7-10-9.3C.5 8.4 2 4.5 5.7 4c2-.3 3.7.7 4.8 2.3C11.6 4.7 13.3 3.7 15.3 4c3.7.5 5.2 4.4 3.7 7.7C19.5 16.3 12 21 12 21z"/></svg>
      ${article.likes} · ${article.readTime} мин
    `;
    fragment.querySelector('.article-card__avatar').textContent = article.author.charAt(0).toUpperCase();

    if (article.saved) {
      saveButton.classList.add('is-saved');
    }

    saveButton.addEventListener('click', (e) => {
      e.stopPropagation();
      article.saved = !article.saved;
      renderArticles();
    });

    card.dataset.articleId = article.id;
    card.addEventListener('click', () => openArticle(article.id));
    grid.appendChild(fragment);
  });

  renderPagination(totalPages);
}

function findArticle(id) {
  return articles.find(a => String(a.id) === String(id));
}

function renderHistorySidebar() {
  if (!historyCard || !historyList) return;
  const history = getHistory();
  const items = history
    .map(id => findArticle(id))
    .filter(Boolean)
    .slice(0, 5);

  if (!items.length) {
    historyCard.hidden = true;
    return;
  }

  historyCard.hidden = false;
  historyList.innerHTML = items.map(article => `
    <button class="history-item" type="button" data-history-id="${article.id}">
      <span class="history-item__title">${escapeHtml(article.title)}</span>
      <span class="history-item__meta">${escapeHtml(article.tag)} · ${article.date}</span>
    </button>
  `).join('');

  historyList.querySelectorAll('[data-history-id]').forEach(btn => {
    btn.addEventListener('click', () => openArticle(btn.dataset.historyId));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sanitizeArticleBody(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  template.content.querySelectorAll('script, style, iframe, object, embed, link, meta, form').forEach(el => el.remove());
  template.content.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return template.innerHTML;
}

/* ---------------- Article reading modal ---------------- */
const articleModalOverlay = document.getElementById('articleModalOverlay');
const articleModalClose = document.getElementById('articleModalClose');
const articleModalTag = document.getElementById('articleModalTag');
const articleModalTitle = document.getElementById('articleModalTitle');
const articleModalAvatar = document.getElementById('articleModalAvatar');
const articleModalAuthor = document.getElementById('articleModalAuthor');
const articleModalDate = document.getElementById('articleModalDate');
const articleModalStats = document.getElementById('articleModalStats');
const articleModalBody = document.getElementById('articleModalBody');

function openArticle(id) {
  const article = findArticle(id);
  if (!article || !articleModalOverlay) return;

  pushHistory(id);

  articleModalTag.textContent = article.tag;
  articleModalTitle.textContent = article.title;
  articleModalAvatar.textContent = article.author.charAt(0).toUpperCase();
  articleModalAuthor.textContent = article.author;
  articleModalDate.textContent = article.date;
  articleModalStats.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.7-10-9.3C.5 8.4 2 4.5 5.7 4c2-.3 3.7.7 4.8 2.3C11.6 4.7 13.3 3.7 15.3 4c3.7.5 5.2 4.4 3.7 7.7C19.5 16.3 12 21 12 21z"/></svg>
    ${article.likes} · ${article.readTime} мин
  `;
  articleModalBody.innerHTML = article.body ? sanitizeArticleBody(article.body) : `<p>${escapeHtml(article.text)}</p>`;

  articleModalOverlay.hidden = false;
  document.body.style.overflow = 'hidden';

  renderHistorySidebar();
  if (state.filter === 'history') renderArticles();
}

function closeArticleModal() {
  if (!articleModalOverlay) return;
  articleModalOverlay.hidden = true;
  document.body.style.overflow = '';
}

if (articleModalOverlay) {
  articleModalClose.addEventListener('click', closeArticleModal);
  articleModalOverlay.addEventListener('click', (e) => {
    if (e.target === articleModalOverlay) closeArticleModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !articleModalOverlay.hidden) closeArticleModal();
  });
}

function updateChipState(container, value, key) {
  container.querySelectorAll('.filter-chip').forEach(button => {
    const isActive = button.dataset[key] === value;
    button.classList.toggle('is-active', isActive);
    if (key === 'topic') {
      button.classList.toggle('is-soft-active', isActive);
    }
  });
}

function resetToFirstPage() {
  state.page = 1;
}

statusFilters.addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  resetToFirstPage();
  updateChipState(statusFilters, state.filter, 'filter');
  renderArticles();
});

topicFilters.addEventListener('click', event => {
  const button = event.target.closest('[data-topic]');
  if (!button) return;
  state.topic = button.dataset.topic;
  resetToFirstPage();
  updateChipState(topicFilters, state.topic, 'topic');
  renderArticles();
});

sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  resetToFirstPage();
  renderArticles();
});

writeArticleBtn.addEventListener('click', () => {
  window.location.href = 'write-article';
});

renderArticles();
renderHistorySidebar();

loadUserArticles().then(() => {
  articles = [...userArticles];
  renderArticles();
  renderHistorySidebar();
});
