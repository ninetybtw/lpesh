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

const seedArticles = [
  { id: 1, tag: 'Экзамен', title: 'Как разобрать любой казус по обязательствам за 15 минут', text: 'Пошаговый алгоритм разбора задач для семинара с примерами из практики ВС РФ и готовой схемой ответа на экзамене.', author: 'Мария А.', date: '4 августа', likes: 128, readTime: 6, liked: true, saved: true, topic: 'cases',
    body: `<p>Казус по обязательственному праву почти всегда решается по одной и той же логике — важно не пытаться сразу писать ответ, а сначала разложить условие на элементы.</p>
      <h4>Шаг 1. Определи вид обязательства</h4>
      <p>Договорное или внедоговорное, одностороннее или взаимное. От этого зависит, какие нормы ГК РФ вообще применимы к спору.</p>
      <h4>Шаг 2. Найди момент нарушения</h4>
      <p>Кто, когда и какое именно условие не исполнил или исполнил ненадлежаще — просрочка, недостатки, отказ от исполнения. Это ядро казуса, вокруг которого строится вся аргументация.</p>
      <h4>Шаг 3. Собери последствия</h4>
      <p>Убытки, неустойка, проценты по ст. 395 ГК РФ, отказ от договора — перечисли применимые меры и обоснуй каждую ссылкой на статью.</p>
      <p>Такая структура экономит время на экзамене и защищает от типичной ошибки — пересказа фактов без юридической квалификации.</p>`
  },
  { id: 2, tag: 'Практика ВС РФ', title: 'Что изменилось в позиции судов по неустойке и как это использовать в курсовой', text: 'Короткий обзор свежих подходов и готовые формулировки, которые можно встроить в письменную работу без воды.', author: 'Даниил К.', date: '3 августа', likes: 94, readTime: 8, liked: false, saved: false, topic: 'practice',
    body: `<p>Суды всё чаще проверяют соразмерность неустойки не формально, а с учётом реального ущерба и поведения сторон в конкретном споре.</p>
      <h4>Что стоит отметить в работе</h4>
      <p>Снижение неустойки по ст. 333 ГК РФ — это право, а не обязанность суда, и заявлено оно должно быть ответчиком-предпринимателем прямо, с обоснованием несоразмерности.</p>
      <p>Отдельно стоит показать, как суды соотносят неустойку со средней ставкой по краткосрочным кредитам — это стало устойчивым ориентиром при оценке соразмерности.</p>
      <h4>Готовая формулировка для курсовой</h4>
      <p>«Снижение неустойки судом допустимо только при явной несоразмерности последствиям нарушения обязательства и не должно вести к необоснованному освобождению должника от ответственности» — эту мысль можно развернуть на конкретных примерах из практики.</p>`
  },
  { id: 3, tag: 'Шпаргалки', title: 'Меры пресечения: компактная схема ответа без лишней теории', text: 'Собрал структуру ответа по главе 13 УПК РФ, чтобы можно было повторить тему за 5–7 минут прямо перед парой.', author: 'Виктор П.', date: '2 августа', likes: 151, readTime: 5, liked: true, saved: true, topic: 'notes',
    body: `<p>Тема почти всегда спрашивается по одной и той же схеме: понятие → виды → основания → порядок избрания.</p>
      <h4>Понятие и цель</h4>
      <p>Меры пресечения — способ обеспечить надлежащее поведение обвиняемого (подозреваемого) и не допустить, чтобы он скрылся, продолжил преступную деятельность или помешал производству по делу.</p>
      <h4>Виды по возрастанию строгости</h4>
      <ul><li>Подписка о невыезде</li><li>Личное поручительство</li><li>Запрет определённых действий</li><li>Залог</li><li>Домашний арест</li><li>Заключение под стражу</li></ul>
      <h4>Что важно не забыть на экзамене</h4>
      <p>Заключение под стражу и домашний арест избираются только по решению суда — этот момент чаще всего проверяют дополнительным вопросом.</p>`
  },
  { id: 4, tag: 'Экзамен', title: 'Как не растеряться на дополнительных вопросах комиссии', text: 'Личный опыт и несколько универсальных мостиков, которые помогают перевести разговор в знакомую тебе тему.', author: 'Елена С.', date: '1 августа', likes: 76, readTime: 4, liked: false, saved: false, topic: 'exam',
    body: `<p>Дополнительный вопрос — это не попытка «завалить», а способ комиссии понять, действительно ли ты разбираешься в теме, а не выучил билет наизусть.</p>
      <h4>Универсальный приём — мостик</h4>
      <p>Если вопрос застал врасплох, не молчи: назови ближайшее понятие, которое точно знаешь, и через него перейди к сути вопроса. Комиссия ценит логику рассуждения не меньше, чем точный ответ.</p>
      <h4>Что говорить, если правда не знаешь</h4>
      <p>Честно скажи, что не помнишь точную формулировку, но предложи, как бы стал искать ответ — через какую норму или институт. Это лучше, чем неуверенное угадывание.</p>`
  },
  { id: 5, tag: 'Казусы', title: 'Разбор дела по виндикации: как увидеть логику и не утонуть в фактах', text: 'Разложили спор по шагам: предмет иска, добросовестность, защита владения и типичные ошибки в ответах студентов.', author: 'Ирина Н.', date: '31 июля', likes: 112, readTime: 9, liked: true, saved: false, topic: 'cases',
    body: `<p>Виндикационный иск (ст. 301 ГК РФ) — истребование имущества из чужого незаконного владения. Разбор всегда стоит начинать с проверки трёх условий.</p>
      <h4>Три условия для удовлетворения иска</h4>
      <p>Истец должен доказать право собственности на вещь, вещь должна находиться во владении ответчика, а владение — быть незаконным.</p>
      <h4>Ключевой момент — добросовестность приобретателя</h4>
      <p>Если ответчик — добросовестный возмездный приобретатель, истребовать вещь можно только в случаях, прямо указанных в ст. 302 ГК РФ: вещь утеряна, похищена или выбыла из владения помимо воли собственника.</p>
      <h4>Типичная ошибка студентов</h4>
      <p>Путают виндикационный и негаторный иск — если владение вещью не утрачено, а просто есть препятствия в пользовании, нужен негаторный иск (ст. 304 ГК РФ), а не виндикация.</p>`
  },
  { id: 6, tag: 'Практика ВС РФ', title: 'Пленумы и обзоры: как быстро находить нужную позицию суда под билет', text: 'Показываю, как за несколько минут собрать судебную практику под конкретную тему и превратить её в сильный устный ответ.', author: 'Кирилл В.', date: '30 июля', likes: 89, readTime: 7, liked: false, saved: true, topic: 'practice',
    body: `<p>Быстрый поиск практики — это не про «погуглить в последнюю ночь», а про рабочую привычку держать под рукой 2–3 источника.</p>
      <h4>С чего начать</h4>
      <p>Смотри профильный Пленум ВС РФ по теме билета — там обычно уже собраны основные спорные вопросы с готовыми формулировками правовых позиций.</p>
      <h4>Как вплести это в устный ответ</h4>
      <p>Не нужно зачитывать номер постановления наизусть — достаточно сказать «согласно разъяснениям Пленума Верховного Суда» и своими словами передать суть позиции. Это звучит уверенно и показывает, что ты действительно ориентируешься в теме, а не пересказываешь учебник.</p>`
  },
  { id: 7, tag: 'Шпаргалки', title: 'Конституционные права: готовая логика ответа на устном экзамене', text: 'Короткая структура, с которой удобно отвечать по правам и свободам без лишних отступлений и путаницы в формулировках.', author: 'Арина М.', date: '29 июля', likes: 117, readTime: 5, liked: true, saved: true, topic: 'notes',
    body: `<p>Ответ по любому конституционному праву удобно строить по одной и той же логике: понятие → содержание → ограничения → гарантии.</p>
      <h4>Понятие и содержание</h4>
      <p>Кратко скажи, что это за право, к какой группе относится (личные, политические, социально-экономические) и в какой статье Конституции РФ закреплено.</p>
      <h4>Ограничения</h4>
      <p>Почти любое право может быть ограничено федеральным законом в целях, указанных в ч. 3 ст. 55 Конституции РФ — это стоит упомянуть, чтобы показать полноту ответа.</p>
      <h4>Гарантии</h4>
      <p>Завершай ответ механизмом защиты: судебная защита, обращение в Конституционный Суд РФ, международные механизмы — в зависимости от конкретного права.</p>`
  },
  { id: 8, tag: 'Казусы', title: 'Обязательства и убытки: как отличать реальный ущерб от упущенной выгоды', text: 'Схема для разбора задач и типовые формулы, которые помогают быстро квалифицировать спор на практике.', author: 'Олег Т.', date: '28 июля', likes: 67, readTime: 6, liked: false, saved: false, topic: 'cases',
    body: `<p>Убытки по ст. 15 ГК РФ состоят из двух частей, и в казусах важно чётко разделять их, а не писать «убытки» одним словом.</p>
      <h4>Реальный ущерб</h4>
      <p>Расходы, которые лицо уже понесло или должно будет понести для восстановления нарушенного права, а также утрата или повреждение имущества.</p>
      <h4>Упущенная выгода</h4>
      <p>Доходы, которые лицо получило бы при обычных условиях оборота, если бы его право не было нарушено. Здесь важно доказать не просто вероятность, а реальную возможность получения дохода.</p>
      <h4>Как это оформить в ответе на казус</h4>
      <p>Раздели расчёт на две строки — реальный ущерб отдельно, упущенная выгода отдельно — и обоснуй каждую цифру фактами из условия задачи.</p>`
  },
  { id: 9, tag: 'Экзамен', title: 'Как собрать план ответа по уголовному процессу за 3 минуты', text: 'Принцип универсального каркаса: понятие, основания, порядок, субъекты и практический акцент для сильного ответа.', author: 'Анна Р.', date: '27 июля', likes: 142, readTime: 4, liked: true, saved: true, topic: 'exam',
    body: `<p>Для большинства билетов по уголовному процессу подходит один и тот же универсальный каркас — держи его в голове, и план ответа соберётся за пару минут.</p>
      <h4>Каркас ответа</h4>
      <ul><li>Понятие и значение института</li><li>Основания применения</li><li>Субъекты, которые принимают решение</li><li>Порядок и сроки</li><li>Практический пример или позиция ВС РФ</li></ul>
      <p>Такой план не только помогает не забыть важное, но и структурирует речь — комиссия сразу видит, что ты понимаешь логику темы, а не пересказываешь текст билета.</p>`
  }
];
seedArticles.forEach((a, i) => { a.sortTs = 1700000000000 - i * 86400000; });

let articles = [...userArticles, ...seedArticles];

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
  window.location.href = 'write-article.html';
});

renderArticles();
renderHistorySidebar();

loadUserArticles().then(() => {
  articles = [...userArticles, ...seedArticles];
  renderArticles();
  renderHistorySidebar();
});
