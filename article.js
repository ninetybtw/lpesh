const articles = [
  { id: 1, tag: 'Экзамен', title: 'Как разобрать любой казус по обязательствам за 15 минут', text: 'Пошаговый алгоритм разбора задач для семинара с примерами из практики ВС РФ и готовой схемой ответа на экзамене.', author: 'Мария А.', date: '4 августа', likes: 128, readTime: 6, liked: true, read: true, saved: true, topic: 'cases' },
  { id: 2, tag: 'Практика ВС РФ', title: 'Что изменилось в позиции судов по неустойке и как это использовать в курсовой', text: 'Короткий обзор свежих подходов и готовые формулировки, которые можно встроить в письменную работу без воды.', author: 'Даниил К.', date: '3 августа', likes: 94, readTime: 8, liked: false, read: true, saved: false, topic: 'practice' },
  { id: 3, tag: 'Шпаргалки', title: 'Меры пресечения: компактная схема ответа без лишней теории', text: 'Собрал структуру ответа по главе 13 УПК РФ, чтобы можно было повторить тему за 5–7 минут прямо перед парой.', author: 'Виктор П.', date: '2 августа', likes: 151, readTime: 5, liked: true, read: false, saved: true, topic: 'notes' },
  { id: 4, tag: 'Экзамен', title: 'Как не растеряться на дополнительных вопросах комиссии', text: 'Личный опыт и несколько универсальных мостиков, которые помогают перевести разговор в знакомую тебе тему.', author: 'Елена С.', date: '1 августа', likes: 76, readTime: 4, liked: false, read: false, saved: false, topic: 'exam' },
  { id: 5, tag: 'Казусы', title: 'Разбор дела по виндикации: как увидеть логику и не утонуть в фактах', text: 'Разложили спор по шагам: предмет иска, добросовестность, защита владения и типичные ошибки в ответах студентов.', author: 'Ирина Н.', date: '31 июля', likes: 112, readTime: 9, liked: true, read: true, saved: false, topic: 'cases' },
  { id: 6, tag: 'Практика ВС РФ', title: 'Пленумы и обзоры: как быстро находить нужную позицию суда под билет', text: 'Показываю, как за несколько минут собрать судебную практику под конкретную тему и превратить её в сильный устный ответ.', author: 'Кирилл В.', date: '30 июля', likes: 89, readTime: 7, liked: false, read: false, saved: true, topic: 'practice' },
  { id: 7, tag: 'Шпаргалки', title: 'Конституционные права: готовая логика ответа на устном экзамене', text: 'Короткая структура, с которой удобно отвечать по правам и свободам без лишних отступлений и путаницы в формулировках.', author: 'Арина М.', date: '29 июля', likes: 117, readTime: 5, liked: true, read: true, saved: true, topic: 'notes' },
  { id: 8, tag: 'Казусы', title: 'Обязательства и убытки: как отличать реальный ущерб от упущенной выгоды', text: 'Схема для разбора задач и типовые формулы, которые помогают быстро квалифицировать спор на практике.', author: 'Олег Т.', date: '28 июля', likes: 67, readTime: 6, liked: false, read: false, saved: false, topic: 'cases' },
  { id: 9, tag: 'Экзамен', title: 'Как собрать план ответа по уголовному процессу за 3 минуты', text: 'Принцип универсального каркаса: понятие, основания, порядок, субъекты и практический акцент для сильного ответа.', author: 'Анна Р.', date: '27 июля', likes: 142, readTime: 4, liked: true, read: false, saved: true, topic: 'exam' }
];

const state = {
  filter: 'all',
  topic: 'all',
  sort: 'new',
  page: 1,
  perPage: 4
};

const grid = document.getElementById('articlesGrid');
const template = document.getElementById('articleCardTemplate');
const statusFilters = document.getElementById('statusFilters');
const topicFilters = document.getElementById('topicFilters');
const sortSelect = document.getElementById('sortSelect');
const writeArticleBtn = document.getElementById('writeArticleBtn');
const pagination = document.getElementById('pagination');
const articlesCountChip = document.getElementById('articlesCountChip');
const articlesPageChip = document.getElementById('articlesPageChip');

function applyFilters(list) {
  return list.filter(article => {
    const statusMatch =
      state.filter === 'all' ||
      (state.filter === 'liked' && article.liked) ||
      (state.filter === 'read' && article.read) ||
      (state.filter === 'unread' && !article.read) ||
      (state.filter === 'saved' && article.saved);

    const topicMatch = state.topic === 'all' || article.topic === state.topic;
    return statusMatch && topicMatch;
  });
}

function applySort(list) {
  const sorted = [...list];

  if (state.sort === 'popular') {
    sorted.sort((a, b) => b.likes - a.likes);
  } else if (state.sort === 'readTime') {
    sorted.sort((a, b) => a.readTime - b.readTime);
  } else {
    sorted.sort((a, b) => b.id - a.id);
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
    fragment.querySelector('.article-card__stats').textContent = `${article.likes} ❤ · ${article.readTime} мин`;
    fragment.querySelector('.article-card__avatar').textContent = article.author.charAt(0).toUpperCase();

    if (article.saved) {
      saveButton.classList.add('is-saved');
    }

    saveButton.addEventListener('click', () => {
      article.saved = !article.saved;
      renderArticles();
    });

    card.dataset.articleId = article.id;
    grid.appendChild(fragment);
  });

  renderPagination(totalPages);
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
  window.alert('Здесь можно открыть форму публикации статьи или модальное окно создания материала.');
});

renderArticles();
