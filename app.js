let publishedUserTests = [];
let myUserTests = [];

// Пользовательские тесты теперь настоящая таблица с модерацией
// (public.user_tests) — грузим один раз при старте страницы: все
// опубликованные (видны всем в теме) плюс свои собственные любого
// статуса (чтобы автор видел «на модерации»/«отклонено» у своих же
// тестов). См. renderUserTestsList() ниже и create-test.js/moderator.js.
async function loadUserTestsCache() {
  if (typeof LexPrepApi === 'undefined') return;
  try {
    const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
    const tasks = [LexPrepApi.listPublishedUserTests()];
    if (user) tasks.push(LexPrepApi.listMyUserTests());
    const [published, mine] = await Promise.all(tasks);
    publishedUserTests = published || [];
    myUserTests = mine || [];
  } catch (e) {
    publishedUserTests = [];
    myUserTests = [];
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await (window.LexPrepContentReady || Promise.resolve());
  await loadUserTestsCache();
  initApp();
  initAiChat();
});

/* ---------------- AI consultant chat widget ----------------
   Реальные ответы идут через Edge Function ai-consultant (NVIDIA API,
   ключ только на сервере) — доступ только на тарифах pro/max, лимит в
   день сервер проверяет сам. Здесь только UI + история для контекста.

   У тех, кто оплатил подписку сразу на год (LexPrepPlan.hasAnnualPlan()),
   вместо обычного консультанта — "продвинутый" (золотая кнопка, другая
   модель на сервере — ai-consultant-pro, отдельный дневной лимит) с
   возможностью прикрепить файл. Реально читаем только текстовые форматы
   (.txt/.md/.json/.csv) через FileReader — PDF/DOCX не парсим, это
   отдельная задача на будущее; для них честно показываем, что формат
   пока не поддерживается, вместо того чтобы притворяться, что консультант
   их обработал. */
const AI_ATTACHMENT_TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.csv'];
const AI_ATTACHMENT_MAX_BYTES = 200 * 1024;

function initAiChat() {
  const chatRoot = document.getElementById('aiChat');
  const toggle = document.getElementById('aiChatToggle');
  const toggleText = document.getElementById('aiChatToggleText');
  const badge = document.getElementById('aiChatBadge');
  const title = document.getElementById('aiChatTitle');
  const panel = document.getElementById('aiChatPanel');
  const closeBtn = document.getElementById('aiChatClose');
  const expandBtn = document.getElementById('aiChatExpand');
  const form = document.getElementById('aiChatForm');
  const input = document.getElementById('aiChatInput');
  const body = document.getElementById('aiChatBody');
  const attachBtn = document.getElementById('aiChatAttachBtn');
  const fileInput = document.getElementById('aiChatFileInput');
  const attachmentBox = document.getElementById('aiChatAttachment');
  if (!toggle || !panel || !form || !input || !body) return;

  // Память диалога переживает перезагрузку страницы/переход между темами —
  // раньше history жила только в переменной и обнулялась при каждом
  // открытии страницы заново, из-за чего разговор с ИИ "забывался" уже на
  // следующей странице. Храним в localStorage, ограничивая размер, чтобы
  // не раздувать его бесконечно.
  const AI_CHAT_HISTORY_KEY = 'lexprep_ai_chat_history';
  const MAX_STORED_MESSAGES = 20;

  function loadHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(AI_CHAT_HISTORY_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }

  const history = loadHistory();

  function saveHistory() {
    try {
      localStorage.setItem(AI_CHAT_HISTORY_KEY, JSON.stringify(history.slice(-MAX_STORED_MESSAGES)));
    } catch (e) { /* localStorage переполнен/недоступен — не критично */ }
  }

  let sending = false;
  let pendingAttachment = null; // { name, content }

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem('lexprep_user') || 'null');
    } catch (e) {
      return null;
    }
  }

  function hasPaidPlan(user) {
    if (!user) return false;
    if (user.isAdmin) return true;
    return typeof LexPrepPlan !== 'undefined' && LexPrepPlan.getTier() !== 'basic';
  }

  function isAdvanced(user) {
    return !!user && typeof LexPrepPlan !== 'undefined' && LexPrepPlan.hasAnnualPlan();
  }

  // Внешний вид переключаем один раз при открытии виджета — подписка не
  // меняется прямо во время диалога, а перепроверять на каждый рендер
  // сообщения незачем.
  function applyAdvancedUi(advanced) {
    if (chatRoot) chatRoot.classList.toggle('ai-chat--advanced', advanced);
    if (toggleText) toggleText.textContent = advanced ? 'ИИ-консультант Про' : 'ИИ-консультант';
    if (badge) badge.textContent = advanced ? '★' : 'ИИ';
    if (title) title.textContent = advanced ? 'Продвинутый ИИ-консультант' : 'ИИ-консультант';
    if (attachBtn) attachBtn.hidden = !advanced;
    if (!advanced) clearAttachment();
  }

  function open() {
    applyAdvancedUi(isAdvanced(currentUser()));
    panel.hidden = false;
    input.focus();
  }

  function close() {
    panel.hidden = true;
  }

  toggle.addEventListener('click', () => {
    if (panel.hidden) open(); else close();
  });
  closeBtn.addEventListener('click', close);

  if (expandBtn) {
    const EXPAND_KEY = 'lexprep_ai_chat_expanded';
    if (localStorage.getItem(EXPAND_KEY) === '1') panel.classList.add('ai-chat__panel--expanded');
    expandBtn.addEventListener('click', () => {
      const expanded = panel.classList.toggle('ai-chat__panel--expanded');
      expandBtn.setAttribute('aria-label', expanded ? 'Уменьшить окно' : 'Увеличить окно');
      try { localStorage.setItem(EXPAND_KEY, expanded ? '1' : '0'); } catch (e) { /* не критично */ }
    });
  }

  function formatBotText(text) {
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s) =>
      s
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>');
    const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
    const isTableSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
    const splitCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

    const lines = text.split('\n');
    const parts = [];
    let i = 0;
    while (i < lines.length) {
      if (isTableRow(lines[i]) && lines[i + 1] !== undefined && isTableSeparator(lines[i + 1])) {
        const headerCells = splitCells(lines[i]);
        i += 2;
        const bodyRows = [];
        while (i < lines.length && isTableRow(lines[i])) {
          bodyRows.push(splitCells(lines[i]));
          i++;
        }
        let table = '<div class="ai-chat__table-wrap"><table class="ai-chat__table"><thead><tr>';
        table += headerCells.map((c) => `<th>${inline(escape(c))}</th>`).join('');
        table += '</tr></thead><tbody>';
        bodyRows.forEach((row) => {
          table += '<tr>' + row.map((c) => `<td>${inline(escape(c))}</td>`).join('') + '</tr>';
        });
        table += '</tbody></table></div>';
        parts.push(table);
        continue;
      }
      const escaped = escape(lines[i]);
      const heading = escaped.match(/^#{1,6}\s+(.*)$/);
      if (heading) {
        parts.push(`<strong>${inline(heading[1])}</strong>`);
      } else {
        parts.push(inline(escaped.replace(/^[*-]\s+/, '• ')));
      }
      i++;
    }
    return parts.join('<br>');
  }

  function addMessage(text, who) {
    const msg = document.createElement('div');
    msg.className = `ai-chat__msg ai-chat__msg--${who}`;
    if (who === 'bot') {
      msg.innerHTML = formatBotText(text);
    } else {
      msg.textContent = text;
    }
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
    return msg;
  }

  // Восстанавливаем видимые сообщения из сохранённой истории — иначе
  // получилось бы странно: ИИ "помнит" контекст, а человек на экране видит
  // пустой чат и не понимает, почему ответ ссылается на что-то раньше.
  if (history.length) {
    history.forEach(m => addMessage(m.content, m.role === 'user' ? 'user' : 'bot'));
  }

  function clearAttachment() {
    pendingAttachment = null;
    if (fileInput) fileInput.value = '';
    if (attachmentBox) {
      attachmentBox.hidden = true;
      attachmentBox.innerHTML = '';
    }
  }

  function renderAttachment() {
    if (!attachmentBox || !pendingAttachment) return;
    attachmentBox.hidden = false;
    attachmentBox.innerHTML = '';
    const chip = document.createElement('span');
    chip.className = 'ai-chat__attachment-chip';
    chip.textContent = pendingAttachment.name;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ai-chat__attachment-remove';
    removeBtn.setAttribute('aria-label', 'Убрать файл');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', clearAttachment);
    chip.appendChild(removeBtn);
    attachmentBox.appendChild(chip);
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      const lowerName = file.name.toLowerCase();
      const isTextFile = AI_ATTACHMENT_TEXT_EXTENSIONS.some(ext => lowerName.endsWith(ext));
      if (!isTextFile) {
        addMessage(`Формат файла «${file.name}» пока не поддерживается — сейчас можно прикреплять только текстовые файлы (${AI_ATTACHMENT_TEXT_EXTENSIONS.join(', ')}). Поддержка PDF/DOCX появится позже.`, 'bot');
        fileInput.value = '';
        return;
      }
      if (file.size > AI_ATTACHMENT_MAX_BYTES) {
        addMessage(`Файл «${file.name}» слишком большой (максимум ${Math.round(AI_ATTACHMENT_MAX_BYTES / 1024)} КБ).`, 'bot');
        fileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        pendingAttachment = { name: file.name, content: String(reader.result || '') };
        renderAttachment();
      };
      reader.onerror = () => {
        addMessage('Не удалось прочитать файл.', 'bot');
      };
      reader.readAsText(file);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const text = input.value.trim();
    if (!text) return;

    if (typeof LexPrepApi === 'undefined') {
      addMessage('Нет соединения с сервером — попробуй обновить страницу.', 'bot');
      return;
    }

    const user = currentUser();
    if (!user) {
      addMessage('Сначала войди в аккаунт, чтобы пользоваться ИИ-консультантом.', 'bot');
      return;
    }
    if (!hasPaidPlan(user)) {
      addMessage('ИИ-консультант доступен на тарифах «Про» и «Максимум» — оформи подписку в магазине.', 'bot');
      return;
    }

    const advanced = isAdvanced(user);
    const attachment = advanced ? pendingAttachment : null;

    addMessage(attachment ? `${text} 📎 ${attachment.name}` : text, 'user');
    input.value = '';
    clearAttachment();
    sending = true;
    const pending = addMessage('Печатает…', 'bot');
    pending.classList.add('is-typing');
    pending.setAttribute('aria-label', 'Консультант печатает');
    pending.innerHTML = '<span></span><span></span><span></span>';

    try {
      const result = advanced
        ? await LexPrepApi.askAiConsultantPro(text, history, attachment)
        : await LexPrepApi.askAiConsultant(text, history);
      pending.classList.remove('is-typing');
      pending.removeAttribute('aria-label');
      pending.innerHTML = formatBotText(result.reply);
      history.push({ role: 'user', content: text }, { role: 'assistant', content: result.reply });
      saveHistory();
      if (typeof result.remaining === 'number' && result.remaining <= 2) {
        addMessage(`Осталось запросов сегодня: ${result.remaining} из ${result.limit}.`, 'bot');
      }
    } catch (err) {
      pending.classList.remove('is-typing');
      pending.removeAttribute('aria-label');
      pending.textContent = err.message;
    } finally {
      sending = false;
      body.scrollTop = body.scrollHeight;
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initApp() {
  const DATA = LEXPREP_DATA;

  const disciplineSelectBtn = document.getElementById('disciplineSelectBtn');
  const disciplineSelectValue = document.getElementById('disciplineSelectValue');
  const disciplineSelectMenu = document.getElementById('disciplineSelectMenu');
  const topicSelectBtn = document.getElementById('topicSelectBtn');
  const topicSelectValue = document.getElementById('topicSelectValue');
  const topicSelectMenu = document.getElementById('topicSelectMenu');
  const searchResults = document.getElementById('searchResults');
  const contentView = document.getElementById('contentView');

  if (!disciplineSelectBtn || !topicSelectBtn || !contentView) return;

  localStorage.setItem('lexprep_visited_app', '1');

  const urlParams = new URLSearchParams(window.location.search);
  let activeDiscipline = DATA.find(d => d.id === urlParams.get('discipline')) || DATA[0];
  let activeTopic = activeDiscipline.topics.find(t => t.id === urlParams.get('topic')) || activeDiscipline.topics[0];
  let activeView = urlParams.get('view') === 'test' ? 'test' : 'notes';
  const highlightTestId = urlParams.get('highlight');
  let cardQueue = [];
  let cardPos = 0;
  let cardFlipped = false;
  let cardMode = 'text';
  let skipCardEnter = false;
  let cardFlipping = false;
  let voiceAnswerResult = null;
  let voiceTranscript = '';
  let voiceError = '';
  let searchQuery = '';
  const SPEECH_RECOGNITION_SUPPORTED = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const RU_STOPWORDS = new Set(['это', 'что', 'как', 'для', 'при', 'или', 'если', 'его', 'она', 'они', 'все', 'был', 'быть', 'есть', 'так', 'также', 'между', 'может', 'могут', 'который', 'которая', 'которые', 'том', 'том,', 'года', 'году']);

  function extractKeywords(text) {
    return Array.from(new Set(
      String(text || '')
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !RU_STOPWORDS.has(w))
    ));
  }

  function checkVoiceAnswer(spokenText, cardBack) {
    const keywords = extractKeywords(cardBack);
    if (!keywords.length) return { ratio: 0, matched: [], total: 0 };
    const spokenLower = String(spokenText || '').toLowerCase();
    const matched = keywords.filter(k => spokenLower.includes(k));
    return { ratio: matched.length / keywords.length, matched, total: keywords.length };
  }

  // Объединяем опубликованные тесты (видны всем) со своими же тестами
  // любого статуса (чтобы автор видел свои "на модерации"/"отклонено"),
  // без дублей — если свой тест уже опубликован, берём только одну копию.
  function getUserTests() {
    const seen = new Set();
    const combined = [];
    myUserTests.forEach(t => { seen.add(t.id); combined.push(t); });
    publishedUserTests.forEach(t => { if (!seen.has(t.id)) combined.push(t); });
    return combined;
  }

  function buildCardQueue(forceAll) {
    const cards = activeTopic.cards || [];
    cardQueue = forceAll
      ? cards.map((_, i) => i)
      : LexPrepProgress.getDueCardIndexes(activeTopic.id, cards);
    cardPos = 0;
    cardFlipped = false;
    voiceAnswerResult = null;
    voiceTranscript = '';
    voiceError = '';
  }

  // Единая точка смены темы/дисциплины.
  function switchTopic(discipline, topic, opts) {
    opts = opts || {};
    activeDiscipline = discipline;
    activeTopic = topic;
    activeView = 'notes';
    buildCardQueue(false);
    if (opts.resetSearch !== false) {
      searchQuery = '';
      const searchInput = document.getElementById('topicSearch');
      if (searchInput) searchInput.value = '';
      if (searchResults) searchResults.hidden = true;
    }
    renderSelectors();
    renderContent();
  }

  function closeSelectMenus() {
    if (disciplineSelectMenu) disciplineSelectMenu.hidden = true;
    if (topicSelectMenu) topicSelectMenu.hidden = true;
    syncSheetState();
  }

  // На телефоне выпадающие списки дисциплины/темы показываются шторкой
  // снизу (см. .app-select__menu в app.css) — под ней затемнение и
  // заблокированная прокрутка страницы.
  function syncSheetState() {
    const open = !disciplineSelectMenu.hidden || !topicSelectMenu.hidden;
    document.body.classList.toggle('sheet-open', open);
  }

  function openSelectMenu(menu) {
    menu.hidden = false;
    syncSheetState();
    // Прокручиваем только сам список (не страницу) к выбранному пункту.
    const active = menu.querySelector('.item-btn.is-active');
    if (active) menu.scrollTop = Math.max(0, active.offsetTop - menu.clientHeight / 2 + active.offsetHeight / 2);
    if (window.LexPrepMotion) LexPrepMotion.stagger(menu, '.item-btn');
  }

  // Дисциплина и тема — два выпадающих списка над контентом (а не
  // постоянные боковые колонки): так контент всегда занимает всё окно,
  // а переключение темы не сворачивает/разворачивает соседние панели.
  function renderSelectors() {
    disciplineSelectValue.textContent = activeDiscipline.title;
    disciplineSelectMenu.innerHTML = '<div class="app-select__sheet-head">Дисциплина</div>' + DATA.map(d => {
      const progress = LexPrepProgress.getDisciplineProgress(d);
      const locked = LexPrepPlan.isDisciplineLocked(d.id, DATA);
      return `
      <button type="button" class="item-btn ${d.id === activeDiscipline.id ? 'is-active' : ''} ${locked ? 'is-locked' : ''}" data-discipline="${d.id}">
        ${escapeHtml(d.title)}
        ${locked ? '<span class="item-lock-badge">Про</span>' : `
        <span class="item-progress">
          <span class="item-progress__track"><span class="item-progress__fill" style="width: ${progress}%"></span></span>
          <span class="item-progress__label">${progress}%</span>
        </span>
        `}
      </button>
    `;
    }).join('');

    disciplineSelectMenu.querySelectorAll('[data-discipline]').forEach(btn => {
      btn.addEventListener('click', () => {
        const discipline = DATA.find(d => d.id === btn.dataset.discipline);
        closeSelectMenus();
        switchTopic(discipline, discipline.topics[0]);
      });
    });

    topicSelectValue.textContent = activeTopic.title;
    topicSelectMenu.innerHTML = `<div class="app-select__sheet-head">${escapeHtml(activeDiscipline.title)}</div>` + activeDiscipline.topics.map(t => {
      const progress = LexPrepProgress.getTopicProgress(t.id, t);
      return `
      <button type="button" class="item-btn ${t.id === activeTopic.id ? 'is-active' : ''}" data-topic="${t.id}">
        ${escapeHtml(t.title)}
        <span class="item-progress">
          <span class="item-progress__track"><span class="item-progress__fill" style="width: ${progress}%"></span></span>
          <span class="item-progress__label">${progress}%</span>
        </span>
      </button>
    `;
    }).join('');

    topicSelectMenu.querySelectorAll('[data-topic]').forEach(btn => {
      btn.addEventListener('click', () => {
        const topic = activeDiscipline.topics.find(t => t.id === btn.dataset.topic);
        closeSelectMenus();
        switchTopic(activeDiscipline, topic);
      });
    });
  }

  function renderSearchResults() {
    if (!searchResults) return;
    if (!searchQuery) {
      searchResults.hidden = true;
      searchResults.innerHTML = '';
      return;
    }

    const q = searchQuery;
    const matches = [];
    DATA.forEach(d => {
      d.topics.forEach(t => {
        const haystack = `${t.title} ${t.description}`.toLowerCase();
        if (haystack.includes(q)) matches.push({ discipline: d, topic: t });
      });
    });

    searchResults.innerHTML = matches.length
      ? matches.map(m => `
          <button type="button" class="item-btn search-result-btn" data-discipline="${m.discipline.id}" data-topic="${m.topic.id}">
            <span class="search-result-btn__topic">${escapeHtml(m.topic.title)}</span>
            <span class="search-result-btn__discipline">${escapeHtml(m.discipline.title)}</span>
          </button>
        `).join('')
      : `<p class="topic-desc">Ничего не найдено.</p>`;

    searchResults.querySelectorAll('[data-topic]').forEach(btn => {
      btn.addEventListener('click', () => {
        const discipline = DATA.find(d => d.id === btn.dataset.discipline);
        const topic = discipline.topics.find(t => t.id === btn.dataset.topic);
        switchTopic(discipline, topic);
      });
    });

    searchResults.hidden = false;
    if (window.LexPrepMotion) LexPrepMotion.stagger(searchResults, '.item-btn');
  }

  // Примерное время чтения конспекта (~170 слов в минуту).
  function readingMinutes(html) {
    const text = String(html || '').replace(/<[^>]+>/g, ' ');
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 170));
  }

  function renderContent(animate) {
    if (animate === undefined) animate = true;
    contentView.classList.remove('content-fade-in');

    // Если вкладки сейчас «прилипли» к шапке (человек дочитал конспект
    // далеко вниз), после переключения вида возвращаем его к началу
    // панели — иначе новый вид откроется где-то посередине.
    const prevTabs = contentView.querySelector('.topic-tabs');
    const tabsWereStuck = !animate && prevTabs && prevTabs.getBoundingClientRect().top <= stickyTopOffset() + 2;

    const locked = LexPrepPlan.isDisciplineLocked(activeDiscipline.id, DATA);

    contentView.innerHTML = `
      <div class="breadcrumbs">
        <span>LexPrep</span>
        <span>→</span>
        <span>${escapeHtml(activeDiscipline.title)}</span>
        <span>→</span>
        <span>${escapeHtml(activeTopic.title)}</span>
      </div>

      <h1 class="topic-title">${escapeHtml(activeTopic.title)}</h1>
      <p class="topic-desc">${escapeHtml(activeTopic.description)}</p>
      <div class="topic-meta">
        ${activeTopic.theory ? `<span class="topic-meta__chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>≈ ${readingMinutes(activeTopic.theory)} мин чтения</span>` : ''}
        ${activeTopic.cards && activeTopic.cards.length ? `<span class="topic-meta__chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/></svg>${activeTopic.cards.length} карточек</span>` : ''}
        ${activeTopic.test && activeTopic.test.length ? `<span class="topic-meta__chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>${activeTopic.test.length} вопросов</span>` : ''}
      </div>

      <div class="content-body ${locked ? 'is-blurred' : ''}">
      <div class="topic-tabs" role="tablist">
        <button class="topic-tab ${activeView === 'notes' ? 'is-active' : ''}" type="button" data-view="notes">Конспект</button>
        <button class="topic-tab ${activeView === 'cards' ? 'is-active' : ''}" type="button" data-view="cards">Карточки</button>
        <button class="topic-tab ${activeView === 'test' ? 'is-active' : ''}" type="button" data-view="test">Тесты</button>
        <button class="topic-tab ${activeView === 'practice' ? 'is-active' : ''}" type="button" data-view="practice">${activeDiscipline.id === 'constitutional' ? 'Практика КС РФ' : 'Практика ВС РФ'}</button>
        <button class="topic-tab ${activeView === 'notepad' ? 'is-active' : ''}" type="button" data-view="notepad">Мои заметки</button>
        ${LexPrepPlan.getLimits().pdfExport ? `
          <button class="topic-tab topic-tab--pdf" type="button" id="downloadPdfBtn">Скачать PDF</button>
        ` : ''}
      </div>

      <div class="theory-view" data-view-panel="notes" ${activeView === 'notes' ? '' : 'hidden'}>
        ${activeTopic.theory}
      </div>

      <div class="flashcards" data-view-panel="cards" ${activeView === 'cards' ? '' : 'hidden'}>
        ${activeTopic.cards && activeTopic.cards.length ? `
          <div class="flashcards__meta">
            <span class="flashcards__due" id="cardsDueLabel"></span>
            <div class="flashcards__meta-actions">
              <div class="mode-toggle" role="tablist" aria-label="Режим тренировки">
                <button class="mode-toggle__btn ${cardMode === 'text' ? 'is-active' : ''}" type="button" data-mode="text">Текст</button>
                <button class="mode-toggle__btn ${cardMode === 'voice' ? 'is-active' : ''}" type="button" data-mode="voice" ${SPEECH_RECOGNITION_SUPPORTED ? '' : 'disabled title="Голосовой ввод не поддерживается в этом браузере"'}>Голос</button>
              </div>
              <button class="btn btn--ghost" type="button" id="reviewAllBtn">Повторить всё</button>
            </div>
          </div>
          <div id="cardSessionArea"></div>
        ` : `<p class="topic-desc">Для этой темы карточки пока не добавлены.</p>`}
      </div>

      <div data-view-panel="practice" ${activeView === 'practice' ? '' : 'hidden'}>
        ${activeTopic.practice ? activeTopic.practice : '<p class="topic-desc">Судебная практика по теме появится позже — раздел в разработке.</p>'}
      </div>

      <div class="notepad" data-view-panel="notepad" ${activeView === 'notepad' ? '' : 'hidden'}>
        <p class="topic-desc">Заметки видны только тебе и сохраняются в этом браузере.</p>
        <textarea class="notepad__textarea" id="notepadArea" placeholder="Запиши здесь свою формулировку, вопрос к семинару или то, что легко забыть..."></textarea>
        <span class="notepad__status" id="notepadStatus"></span>
      </div>

      <div class="test-box" data-view-panel="test" ${activeView === 'test' ? '' : 'hidden'}>
        <div class="tests-toolbar">
          <h2 class="test-box__title">Тесты по теме</h2>
          <button class="btn btn--primary" type="button" id="createTestBtn">Создать тест</button>
        </div>

        <div class="test-card" id="mainTestCard">
          <button class="test-card__head" type="button" data-test-toggle="main">
            <span class="test-card__head-info">
              <span class="test-card__title">Основной тест LexPrep</span>
              <span class="test-card__meta">${activeTopic.test.length} вопросов</span>
            </span>
            <svg class="test-card__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="test-card__body" id="testBody-main" hidden></div>
        </div>

        <h3 class="profile-subheading">Пользовательские тесты</h3>
        <div class="user-tests-list" id="userTestsList"></div>
      </div>
      </div>

      ${locked ? `
        <div class="content-lock-overlay">
          <div class="content-lock-overlay__card">
            <div class="paywall__badge">Тариф «Про»</div>
            <h2 class="paywall__title">Эта дисциплина закрыта без подписки</h2>
            <p class="paywall__text">
              На тарифе «Базовый» полностью открыта только одна дисциплина (выбирается в настройках профиля) — конспект, карточки и тесты остальных скрыты.
              На «Про» открываются все дисциплины и темы без ограничений, тесты — с разбором ответов, до 5 попыток в день и дуэли с турнирами.
              На «Максимум» — вообще без лимитов, плюс экспорт конспектов в PDF.
            </p>
            <a class="btn btn--primary" href="index.html#pricing">Оформить подписку</a>
          </div>
        </div>
      ` : ''}
    `;

    if (animate) {
      void contentView.offsetWidth;
      contentView.classList.add('content-fade-in');
    }

    const tabsEl = contentView.querySelector('.topic-tabs');
    const activeTabEl = tabsEl && tabsEl.querySelector('.topic-tab.is-active');
    if (tabsEl && activeTabEl) {
      // На телефоне вкладки — горизонтальная лента: держим активную по центру.
      tabsEl.scrollLeft = activeTabEl.offsetLeft - (tabsEl.clientWidth - activeTabEl.offsetWidth) / 2;
      if (tabsWereStuck) {
        window.scrollTo({ top: window.scrollY + tabsEl.getBoundingClientRect().top - stickyTopOffset() });
      }
    }
    const activePanel = contentView.querySelector(`[data-view-panel="${activeView}"]`);
    if (activePanel && window.LexPrepMotion) {
      if (animate && activeView === 'notes') {
        LexPrepMotion.stagger(activePanel, ':scope > :not(.theory), :scope > .theory > *', 120);
      } else if (!animate) {
        activePanel.classList.add('view-panel-in');
      }
    }
    updateReadingProgress();

    if (activeView === 'notes' && !locked && activeTopic.theory) {
      LexPrepProgress.recordTheoryView(activeTopic.id);
      renderGamifyBar();
    }

    renderUserTestsList();

    const createTestBtn = document.getElementById('createTestBtn');
    if (createTestBtn) {
      createTestBtn.addEventListener('click', () => {
        window.location.href = `create-test.html?discipline=${encodeURIComponent(activeDiscipline.id)}&topic=${encodeURIComponent(activeTopic.id)}`;
      });
    }

    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    if (downloadPdfBtn) {
      downloadPdfBtn.addEventListener('click', () => downloadTopicPdf(activeTopic));
    }

    contentView.querySelectorAll('[data-view]').forEach(tab => {
      tab.addEventListener('click', () => {
        activeView = tab.dataset.view;
        renderContent(false);
      });
    });

    renderCardSession();
    initNotepad();

    const reviewAllBtn = document.getElementById('reviewAllBtn');
    if (reviewAllBtn) {
      reviewAllBtn.addEventListener('click', () => {
        buildCardQueue(true);
        renderCardSession();
      });
    }

    const modeToggleBtns = contentView.querySelectorAll('.mode-toggle__btn');
    modeToggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        cardMode = btn.dataset.mode;
        voiceAnswerResult = null;
        voiceTranscript = '';
        voiceError = '';
        cardFlipped = false;
        modeToggleBtns.forEach(b => b.classList.toggle('is-active', b.dataset.mode === cardMode));
        renderCardSession();
      });
    });
  }

  // PDF-экспорт конспекта — доступен только на тарифе «Максимум»
  // (LexPrepPlan.getLimits().pdfExport). jsPDF рисует простой текстовый
  // документ: заголовок темы + текст конспекта построчно с переносом.
  // Разметка (жирный/списки/таблицы) не переносится — это читаемая
  // текстовая копия для офлайн-подготовки, не точная копия вёрстки.
  function downloadTopicPdf(topic) {
    if (typeof jspdf === 'undefined') {
      alert('Не удалось загрузить модуль PDF — попробуй обновить страницу.');
      return;
    }
    if (typeof LEXPREP_PDF_FONTS === 'undefined') {
      alert('Не удалось загрузить шрифт для PDF — попробуй обновить страницу.');
      return;
    }
    const { jsPDF } = jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    // Встроенные шрифты jsPDF (helvetica и т.п.) не знают кириллицу —
    // без своего шрифта конспект превращается в нечитаемую кашу из
    // символов. Roboto с кириллицей зашит в vendor/roboto-fonts.js.
    doc.addFileToVFS('Roboto-Regular.ttf', LEXPREP_PDF_FONTS.regular);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFileToVFS('Roboto-Medium.ttf', LEXPREP_PDF_FONTS.medium);
    doc.addFont('Roboto-Medium.ttf', 'Roboto', 'bold');
    doc.setFont('Roboto', 'normal');

    const marginX = 52;
    const marginTop = 56;
    const marginBottom = 56;
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = doc.internal.pageSize.getWidth() - marginX * 2;
    let y = marginTop;

    function ensureSpace(neededHeight) {
      if (y + neededHeight > pageHeight - marginBottom) {
        doc.addPage();
        y = marginTop;
      }
    }

    function addLine(text, fontSize, isBold, indent) {
      doc.setFontSize(fontSize);
      doc.setFont('Roboto', isBold ? 'bold' : 'normal');
      doc.setTextColor(isBold ? 20 : 45);
      const lines = doc.splitTextToSize(text, maxWidth - (indent || 0));
      lines.forEach(line => {
        ensureSpace(fontSize * 1.4);
        doc.text(line, marginX + (indent || 0), y);
        y += fontSize * 1.4;
      });
    }

    addLine(topic.title, 17, true);
    doc.setTextColor(150);
    doc.setFontSize(9.5);
    doc.setFont('Roboto', 'normal');
    ensureSpace(14);
    doc.text('LexPrep — конспект для офлайн-подготовки', marginX, y);
    y += 8;
    doc.setDrawColor(220);
    doc.line(marginX, y, marginX + maxWidth, y);
    y += 20;

    const container = document.createElement('div');
    container.innerHTML = topic.theory || '';
    container.querySelectorAll('h1, h2, h3, h4, p, li').forEach(el => {
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      if (!text) return;
      const isHeading = /^H[1-4]$/.test(el.tagName);
      const isListItem = el.tagName === 'LI';
      if (isHeading) {
        y += 8;
        addLine(text, 13, true);
        y += 2;
      } else if (isListItem) {
        addLine(`•  ${text}`, 11, false, 12);
      } else {
        addLine(text, 11, false);
        y += 4;
      }
    });

    doc.save(`${topic.title.replace(/[\\/:*?"<>|]/g, '')}.pdf`);
  }

  // Вопрос может иметь один или несколько правильных ответов —
  // q.correct всегда массив индексов (длина 1 для одиночного выбора).
  // Рендерим radio, если ответ один, checkbox — если несколько.
  function renderTestQuestions(container, rawQuestions, progressKey) {
    // На всякий случай приводим старую форму (q.correct — число, из
    // пользовательских тестов, сохранённых до перехода на массив) к новой.
    const questions = rawQuestions.map(q => (
      Array.isArray(q.correct) ? q : { ...q, correct: [q.correct] }
    ));
    container.innerHTML = `
      <div class="questions-wrap">
        ${questions.map((q, qIndex) => {
          const isMulti = q.correct.length > 1;
          return `
          <div class="question" data-question="${qIndex}">
            <h4>${qIndex + 1}. ${escapeHtml(q.question)}</h4>
            ${isMulti ? '<p class="question--multi__hint">Выбери все подходящие варианты</p>' : ''}
            <div class="answers">
              ${q.options.map((option, i) => `
                <label class="answer">
                  <input type="${isMulti ? 'checkbox' : 'radio'}" name="q-${qIndex}" value="${i}">
                  <span>${escapeHtml(option)}</span>
                </label>
              `).join('')}
            </div>
            <div class="question-result" data-result="${qIndex}"></div>
          </div>
        `;
        }).join('')}
      </div>

      <div class="test-actions">
        <span class="test-actions__progress"><strong data-answered>0</strong> из ${questions.length} отвечено</span>
        <button class="btn btn--primary" type="button" data-check-test>Проверить ответы</button>
      </div>

      <div class="summary" data-summary-box></div>
    `;

    const answeredEl = container.querySelector('[data-answered]');
    const updateAnswered = () => {
      const answered = questions.filter((_, qIndex) => container.querySelector(`input[name="q-${qIndex}"]:checked`)).length;
      if (answeredEl) answeredEl.textContent = answered;
      container.querySelector('.test-actions').classList.toggle('is-complete', answered === questions.length);
    };
    // Контейнер теста переиспользуется при повторном открытии —
    // слушатель вешаем один раз, а считает он всегда по текущему рендеру.
    container._updateAnswered = updateAnswered;
    if (!container._answeredBound) {
      container._answeredBound = true;
      container.addEventListener('change', () => container._updateAnswered && container._updateAnswered());
    }
    if (window.LexPrepMotion) LexPrepMotion.stagger(container.querySelector('.questions-wrap'), '.question');

    const checkBtn = container.querySelector('[data-check-test]');
    checkBtn.addEventListener('click', () => {
      const summaryBox = container.querySelector('[data-summary-box]');
      const limits = LexPrepPlan.getLimits();
      const usedToday = LexPrepProgress.getDailyUsage().testsTaken;
      if (usedToday >= limits.testsPerDay && !LexPrepProgress.spendInventory('testAttempts')) {
        summaryBox.classList.add('is-visible');
        summaryBox.innerHTML = `
          <h3>Дневной лимит тестов исчерпан</h3>
          <p>На тарифе «${LexPrepPlan.TIER_TITLES[LexPrepPlan.getTier()]}» доступно ${limits.testsPerDay} ${limits.testsPerDay === 1 ? 'попытка' : 'попытки'} в день.</p>
          <p class="summary__note">Оформи более высокий тариф или докупи попытки в <a href="shop.html">магазине</a>.</p>
        `;
        summaryBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }

      let score = 0;
      const wrongIndexes = [];
      const showExplanations = limits.testExplanations;

      questions.forEach((q, qIndex) => {
        const chosen = Array.from(container.querySelectorAll(`input[name="q-${qIndex}"]:checked`)).map(el => Number(el.value)).sort();
        const correct = [...q.correct].sort();
        const resultBox = container.querySelector(`[data-result="${qIndex}"]`);
        const isCorrect = chosen.length > 0 && chosen.length === correct.length && chosen.every((v, i) => v === correct[i]);
        const correctText = correct.map(i => q.options[i]).join('; ');
        container.querySelectorAll(`input[name="q-${qIndex}"]`).forEach(input => {
          const label = input.closest('.answer');
          const value = Number(input.value);
          label.classList.toggle('is-correct-option', correct.includes(value));
          label.classList.toggle('is-wrong-option', input.checked && !correct.includes(value));
        });
        const explanationLine = showExplanations ? `<br><strong>Почему:</strong> ${escapeHtml(q.explanation || '')}` : '';

        if (isCorrect) {
          score++;
          resultBox.className = 'question-result is-correct';
          resultBox.innerHTML = `Верно.${explanationLine}`;
        } else {
          resultBox.className = 'question-result is-wrong';
          resultBox.innerHTML = `
            ${chosen.length ? 'Неверно.' : 'Ответ не выбран.'}<br>
            <strong>Правильный ответ:</strong> ${escapeHtml(correctText)}${explanationLine}
          `;
          wrongIndexes.push(qIndex);
        }
      });

      const total = questions.length;
      const percent = Math.round((score / total) * 100);

      LexPrepProgress.recordTestAttempt(progressKey, score, total, wrongIndexes);
      renderSelectors();
      renderGamifyBar();

      const verdict = percent >= 90 ? 'Отлично — тема усвоена!' : percent >= 70 ? 'Хороший результат' : percent >= 50 ? 'Неплохо, но есть пробелы' : 'Стоит повторить тему';
      const ringTone = percent >= 70 ? 'good' : percent >= 50 ? 'mid' : 'bad';
      summaryBox.classList.add('is-visible');
      summaryBox.innerHTML = `
        <div class="summary__layout">
          <div class="score-ring score-ring--${ringTone}" style="--p: ${percent}">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="score-ring__track" cx="60" cy="60" r="52" />
              <circle class="score-ring__fill" cx="60" cy="60" r="52" pathLength="100" />
            </svg>
            <span class="score-ring__value"><strong data-score-percent>0</strong>%</span>
          </div>
          <div class="summary__text">
            <h3>${verdict}</h3>
            <p>Правильных ответов: <strong>${score}</strong> из <strong>${total}</strong>.</p>
            <p>Результат: <strong>${percent}%</strong>.</p>
            <p class="summary__note">Если результат ниже 70%, лучше ещё раз пройти теорию и затем перепройти тест. В вопросах с несколькими вариантами засчитывается только полностью верный набор ответов.</p>
          </div>
        </div>
      `;
      const percentEl = summaryBox.querySelector('[data-score-percent]');
      if (window.LexPrepMotion) {
        LexPrepMotion.countTo(percentEl, percent, 1100);
        if (percent >= 90) setTimeout(() => LexPrepMotion.confetti(summaryBox.querySelector('.score-ring')), 500);
      } else {
        percentEl.textContent = percent;
      }

      summaryBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function renderUserTestsList() {
    const listEl = document.getElementById('userTestsList');
    if (!listEl) return;

    const tests = getUserTests()
      .filter(t => t.topicId === activeTopic.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (!tests.length) {
      listEl.innerHTML = '<p class="topic-desc">Пока нет пользовательских тестов по этой теме — стань первым, кто его создаст.</p>';
      initTestAccordion();
      return;
    }

    const statusBadge = {
      pending: '<span class="item-lock-badge">На модерации</span>',
      rejected: '<span class="item-lock-badge">Отклонён</span>'
    };

    listEl.innerHTML = tests.map(test => `
      <div class="test-card">
        <button class="test-card__head" type="button" data-test-toggle="${test.id}" ${test.status && test.status !== 'published' ? 'data-test-unplayable' : ''}>
          <span class="test-card__author">
            <span class="test-card__avatar">${escapeHtml((test.authorName || 'U').trim().charAt(0).toUpperCase())}</span>
            <span class="test-card__author-info">
              <span class="test-card__author-line">${escapeHtml(test.authorName || 'Аноним')} <span class="test-card__level">Ур. ${test.authorLevel || 1}</span></span>
              <span class="test-card__title">${escapeHtml(test.title)} ${statusBadge[test.status] || ''}</span>
            </span>
          </span>
          <span class="test-card__head-info">
            <span class="test-card__meta">${test.questions.length} вопросов</span>
            <svg class="test-card__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="test-card__body" id="testBody-${test.id}" hidden></div>
      </div>
    `).join('');

    initTestAccordion();

    if (highlightTestId && tests.some(t => String(t.id) === highlightTestId)) {
      const targetToggle = listEl.querySelector(`[data-test-toggle="${highlightTestId}"]`);
      if (targetToggle) {
        targetToggle.click();
        targetToggle.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function initTestAccordion() {
    contentView.querySelectorAll('[data-test-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.testToggle;
        const body = document.getElementById(`testBody-${id}`);
        if (!body) return;

        const isOpen = !body.hidden;

        contentView.querySelectorAll('.test-card__body').forEach(b => {
          b.hidden = true;
          b.innerHTML = '';
        });
        contentView.querySelectorAll('.test-card__head').forEach(h => h.classList.remove('is-open'));

        if (isOpen) return;

        body.hidden = false;
        btn.classList.add('is-open');

        if (id === 'main') {
          renderTestQuestions(body, activeTopic.test, activeTopic.id);
        } else {
          const test = getUserTests().find(t => String(t.id) === id);
          if (!test) return;
          if (test.status === 'pending') {
            body.innerHTML = '<p class="topic-desc">Тест ещё на модерации — станет доступен для прохождения, как только его одобрят.</p>';
          } else if (test.status === 'rejected') {
            body.innerHTML = `<p class="topic-desc">Тест отклонён модератором.${test.moderatorComment ? ` Причина: ${escapeHtml(test.moderatorComment)}` : ''}</p>`;
          } else {
            renderTestQuestions(body, test.questions, `${test.topicId}::user::${test.id}`);
          }
        }
      });
    });
  }

  function getNotes() {
    return JSON.parse(localStorage.getItem('lexprep_notes') || '{}');
  }

  function initNotepad() {
    const textarea = document.getElementById('notepadArea');
    const status = document.getElementById('notepadStatus');
    if (!textarea) return;

    const notes = getNotes();
    textarea.value = notes[activeTopic.id] || '';

    let saveTimer = null;
    textarea.addEventListener('input', () => {
      status.innerHTML = '';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const allNotes = getNotes();
        allNotes[activeTopic.id] = textarea.value;
        localStorage.setItem('lexprep_notes', JSON.stringify(allNotes));
        status.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg> Сохранено';
      }, 500);
    });
  }

  function renderCardSession() {
    const area = document.getElementById('cardSessionArea');
    const dueLabel = document.getElementById('cardsDueLabel');
    if (!area) return;

    const cards = activeTopic.cards || [];
    if (dueLabel) dueLabel.textContent = `К повторению сегодня: ${cardQueue.length} из ${cards.length}`;

    if (!cardQueue.length) {
      area.innerHTML = `
        <div class="cards-empty">
          <p class="topic-desc">Все карточки этой темы повторены. Новые появятся здесь по расписанию интервального повторения — или нажми «Повторить всё» выше, чтобы пройти их ещё раз.</p>
        </div>
      `;
      return;
    }

    const cardsLimit = LexPrepPlan.getLimits().cardsPerDay;
    if (LexPrepProgress.getDailyUsage().cardsReviewed >= cardsLimit) {
      area.innerHTML = `
        <div class="cards-empty">
          <p class="topic-desc">Дневной лимит карточек (${cardsLimit}) на тарифе «${LexPrepPlan.TIER_TITLES[LexPrepPlan.getTier()]}» исчерпан. Оформи «Про» для безлимитного повторения — <a href="index.html#pricing">смотреть тарифы</a>.</p>
        </div>
      `;
      return;
    }

    if (cardPos >= cardQueue.length) {
      area.innerHTML = `
        <div class="cards-empty">
          <p class="topic-desc">Готово! Повторено карточек за эту сессию: <strong>${cardQueue.length}</strong>.</p>
        </div>
      `;
      return;
    }

    const cardIndex = cardQueue[cardPos];
    const card = cards[cardIndex];
    const state = LexPrepProgress.getCardState(activeTopic.id, cardIndex);

    area.innerHTML = `
      <div class="card-session">
        <span class="card-session__count">${cardPos + 1} / ${cardQueue.length}</span>
        <span class="card-session__track"><span class="card-session__fill" style="width: ${Math.round((cardPos / cardQueue.length) * 100)}%"></span></span>
      </div>
      <div class="flashcard ${cardFlipped ? 'is-flipped' : ''} ${skipCardEnter ? 'no-enter' : ''}" id="flashcard">
        ${cardFlipped ? `
          <span class="flashcard__stamp flashcard__stamp--yes" aria-hidden="true">Знаю</span>
          <span class="flashcard__stamp flashcard__stamp--no" aria-hidden="true">Не знаю</span>
        ` : ''}
        <div class="flashcard__inner ${cardFlipped ? 'is-flipped' : ''}" id="flashcardInner">
          <div class="flashcard__face flashcard__face--front">
            <span class="flashcard__label">Вопрос</span>
            <p>${escapeHtml(card.front)}</p>
          </div>
          <div class="flashcard__face flashcard__face--back">
            <span class="flashcard__label">Ответ</span>
            <p>${escapeHtml(card.back)}</p>
          </div>
        </div>
      </div>
      <div class="flashcard-box" aria-label="Уровень запоминания карточки">
        ${[1, 2, 3, 4, 5].map(n => `<span class="flashcard-box__dot ${n <= state.box ? 'is-filled' : ''}"></span>`).join('')}
      </div>
      ${!cardFlipped && cardMode === 'voice' ? `
        <div class="voice-trainer">
          <p class="flashcard-hint">Скажи ответ вслух — черновая проверка подскажет, близко ли ты к ответу</p>
          <div class="voice-trainer__row">
            <button class="btn btn--outline voice-mic-btn" type="button" id="voiceMicBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>
              <span id="voiceMicLabel">Записать ответ</span>
            </button>
            ${voiceTranscript ? `<span class="voice-trainer__transcript">«${escapeHtml(voiceTranscript)}»</span>` : ''}
          </div>
          ${voiceError ? `<p class="voice-trainer__error">${escapeHtml(voiceError)}</p>` : ''}
          <div class="voice-trainer__actions">
            <button class="btn btn--primary" type="button" id="voiceCheckBtn" ${voiceTranscript ? '' : 'disabled'}>Проверить</button>
          </div>
          ${voiceAnswerResult ? `
            <div class="voice-verdict voice-verdict--${voiceAnswerResult.ratio >= 0.5 ? 'good' : voiceAnswerResult.ratio > 0.15 ? 'mid' : 'bad'}">
              ${voiceAnswerResult.ratio >= 0.5 ? 'Похоже на верный ответ' : voiceAnswerResult.ratio > 0.15 ? 'Есть совпадения, но не всё' : 'Похоже, ответ далёк от правильного'}
              <span class="voice-verdict__note">Черновая проверка по ключевым словам — это не настоящий ИИ. Окончательную оценку поставь сам(а) после того, как увидишь правильный ответ.</span>
            </div>
          ` : ''}
        </div>
      ` : ''}
      ${!cardFlipped ? `
        <p class="flashcard-hint">Нажми на карточку, чтобы перевернуть</p>
      ` : `
        <p class="flashcard-hint">Оцени, знал(а) ли ты ответ<span class="flashcard-hint__swipe"> · или смахни карточку: вправо — знаю, влево — нет</span></p>
        <div class="flashcard-grade">
          <button class="btn btn--outline" type="button" id="gradeWrongBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
            Не знал(а)
          </button>
          <button class="btn btn--primary" type="button" id="gradeRightBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 5-5"/></svg>
            Знал(а)
          </button>
        </div>
      `}
    `;

    skipCardEnter = false;
    const flashcard = document.getElementById('flashcard');
    let suppressClick = false;
    flashcard.addEventListener('click', () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (cardFlipping) return;
      cardFlipped = !cardFlipped;
      voiceAnswerResult = null;
      // Сначала честно переворачиваем текущую карточку (CSS-переход), и
      // только потом перерисовываем сессию — уже без анимации появления.
      const inner = document.getElementById('flashcardInner');
      const reduced = window.LexPrepMotion && LexPrepMotion.reduced();
      if (inner && !reduced) {
        cardFlipping = true;
        inner.classList.toggle('is-flipped', cardFlipped);
        setTimeout(() => {
          cardFlipping = false;
          skipCardEnter = true;
          renderCardSession();
        }, 480);
      } else {
        renderCardSession();
      }
    });

    const voiceMicBtn = document.getElementById('voiceMicBtn');
    const voiceMicLabel = document.getElementById('voiceMicLabel');
    const voiceCheckBtn = document.getElementById('voiceCheckBtn');
    const VOICE_ERROR_MESSAGES = {
      'not-allowed': 'Доступ к микрофону не разрешён — включи разрешение в настройках браузера.',
      'no-speech': 'Не расслышал(а) ничего — попробуй ещё раз, говори чуть громче.',
      'audio-capture': 'Микрофон не найден или недоступен.',
      network: 'Проблема с сетью при распознавании речи — попробуй ещё раз.'
    };

    if (voiceMicBtn && SPEECH_RECOGNITION_SUPPORTED) {
      const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      voiceMicBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const recognition = new SpeechRecognitionCtor();
        recognition.lang = 'ru-RU';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        voiceError = '';
        voiceMicBtn.classList.add('is-recording');
        voiceMicLabel.textContent = 'Слушаю...';

        recognition.addEventListener('result', (event) => {
          voiceTranscript = event.results[0][0].transcript;
          voiceAnswerResult = null;
        });
        recognition.addEventListener('end', () => {
          renderCardSession();
        });
        recognition.addEventListener('error', (event) => {
          voiceError = VOICE_ERROR_MESSAGES[event.error] || 'Не удалось распознать голос — попробуй ещё раз.';
        });

        recognition.start();
      });
    }

    if (voiceCheckBtn) {
      voiceCheckBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        voiceAnswerResult = checkVoiceAnswer(voiceTranscript, card.back);
        renderCardSession();
      });
    }

    const gradeWrongBtn = document.getElementById('gradeWrongBtn');
    const gradeRightBtn = document.getElementById('gradeRightBtn');

    let graded = false;
    function grade(correct) {
      if (graded) return;
      graded = true;
      LexPrepProgress.reviewCard(activeTopic.id, cardIndex, correct);
      renderGamifyBar();
      flashcard.style.transform = '';
      flashcard.classList.add(correct ? 'flashcard--correct' : 'flashcard--wrong');
      flashcard.classList.add(correct ? 'is-flying-right' : 'is-flying-left');
      if (gradeWrongBtn) gradeWrongBtn.disabled = true;
      if (gradeRightBtn) gradeRightBtn.disabled = true;
      setTimeout(() => {
        cardPos++;
        cardFlipped = false;
        voiceAnswerResult = null;
        voiceTranscript = '';
        voiceError = '';
        renderCardSession();
        renderSelectors();
        if (cardPos >= cardQueue.length && window.LexPrepMotion) {
          LexPrepMotion.confetti(document.getElementById('cardSessionArea'));
        }
      }, 300);
    }

    // Свайп перевёрнутой карточки: вправо — «знал(а)», влево — «не знал(а)».
    // Короткое движение считается обычным кликом (переворот обратно).
    if (cardFlipped) {
      let startX = 0;
      let startY = 0;
      let dx = 0;
      let dragging = false;
      flashcard.addEventListener('pointerdown', (e) => {
        if (graded || (e.pointerType === 'mouse' && e.button !== 0)) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        dx = 0;
        flashcard.classList.add('is-dragging');
      });
      flashcard.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (!flashcard.hasPointerCapture(e.pointerId)) flashcard.setPointerCapture(e.pointerId);
        flashcard.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
        flashcard.style.setProperty('--swipe', Math.max(-1, Math.min(1, dx / 110)).toFixed(3));
      });
      const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        flashcard.classList.remove('is-dragging');
        if (Math.abs(dx) > 6) suppressClick = true;
        if (Math.abs(dx) > 100) {
          grade(dx > 0);
        } else {
          flashcard.style.transform = '';
          flashcard.style.setProperty('--swipe', 0);
        }
      };
      flashcard.addEventListener('pointerup', endDrag);
      flashcard.addEventListener('pointercancel', endDrag);
    }

    if (gradeWrongBtn) {
      gradeWrongBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        grade(false);
      });
    }
    if (gradeRightBtn) {
      gradeRightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        grade(true);
      });
    }
  }

  disciplineSelectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = disciplineSelectMenu.hidden;
    closeSelectMenus();
    if (willOpen) openSelectMenu(disciplineSelectMenu);
  });
  disciplineSelectMenu.addEventListener('click', (e) => e.stopPropagation());

  topicSelectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = topicSelectMenu.hidden;
    closeSelectMenus();
    if (willOpen) openSelectMenu(topicSelectMenu);
  });
  topicSelectMenu.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('click', () => {
    closeSelectMenus();
  });

  const searchInput = document.getElementById('topicSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderSearchResults();
    });
    searchInput.addEventListener('click', (e) => e.stopPropagation());
  }

  let lastGamifyXp = null;
  let lastGamifyLevel = null;

  function restartAnim(el, className) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  // Высота липкой шапки — к ней «прилипают» вкладки темы.
  function stickyTopOffset() {
    const header = document.getElementById('header');
    return header ? header.getBoundingClientRect().height : 0;
  }

  // Тонкая полоса под шапкой: сколько конспекта уже прочитано.
  const readingProgress = document.getElementById('readingProgress');
  const readingProgressBar = document.getElementById('readingProgressBar');
  let readingFrame = 0;
  function updateReadingProgress() {
    if (!readingProgress || !readingProgressBar) return;
    const panel = contentView.querySelector('[data-view-panel="notes"]');
    const visible = activeView === 'notes' && panel && !panel.hidden;
    readingProgress.classList.toggle('is-visible', !!visible);
    if (!visible) return;
    const rect = panel.getBoundingClientRect();
    const total = rect.height - window.innerHeight * 0.6;
    const passed = stickyTopOffset() + 60 - rect.top;
    const ratio = total > 0 ? Math.min(1, Math.max(0, passed / total)) : 0;
    readingProgressBar.style.transform = `scaleX(${ratio.toFixed(4)})`;
  }
  window.addEventListener('scroll', () => {
    cancelAnimationFrame(readingFrame);
    readingFrame = requestAnimationFrame(updateReadingProgress);
  }, { passive: true });
  window.addEventListener('resize', updateReadingProgress);

  const sheetBackdrop = document.getElementById('sheetBackdrop');
  if (sheetBackdrop) sheetBackdrop.addEventListener('click', closeSelectMenus);

  function renderGamifyBar() {
    const bar = document.getElementById('gamifyBar');
    if (!bar || typeof LexPrepProgress.getGamification !== 'function') return;

    const g = LexPrepProgress.getGamification();
    const levelNumEl = document.getElementById('gamifyLevel').querySelector('.gamify-bar__level-num');
    if (lastGamifyLevel !== null && g.level > lastGamifyLevel) restartAnim(levelNumEl, 'is-bump');
    levelNumEl.textContent = g.level;
    document.getElementById('gamifyTitle').textContent = g.rankName;
    const levelTextEl = document.getElementById('gamifyLevelText');
    if (levelTextEl) levelTextEl.textContent = `Уровень ${g.level}`;
    document.getElementById('gamifyXp').textContent = `${g.xpIntoLevel} / ${g.xpForNextLevel} XP`;
    const fillEl = document.getElementById('gamifyFill');
    if (lastGamifyXp === null) {
      // Первый рендер: полоса «набегает» от нуля.
      fillEl.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => { fillEl.style.width = `${g.progressPercent}%`; }));
    } else {
      fillEl.style.width = `${g.progressPercent}%`;
      if (g.xp > lastGamifyXp && window.LexPrepMotion) {
        LexPrepMotion.xpFloat(fillEl.parentElement, g.xp - lastGamifyXp);
        restartAnim(bar, 'is-gain');
      }
    }
    lastGamifyXp = g.xp;
    lastGamifyLevel = g.level;
    const rankIconEl = document.getElementById('gamifyRankIcon');
    if (rankIconEl) rankIconEl.src = `assets/badges/${g.rankIcon}`;

    const achievements = LexPrepProgress.getAchievements(DATA);
    document.getElementById('gamifyBadgesCount').textContent = `${achievements.totalEarned}/${achievements.totalCount}`;

    document.getElementById('gamifyBadges').innerHTML = achievements.categories.map(cat => `
      <div class="gamify-badge ${cat.earnedCount > 0 ? 'is-earned' : ''}">
        <span class="gamify-badge__title">${escapeHtml(cat.title)}</span>
        <span class="gamify-badge__desc">${cat.earnedCount} / ${cat.total}</span>
      </div>
    `).join('') + '<a href="profile.html#stats" class="gamify-badges__link">Все достижения в профиле →</a>';
  }

  const gamifyBadgesToggle = document.getElementById('gamifyBadgesToggle');
  const gamifyBadges = document.getElementById('gamifyBadges');
  if (gamifyBadgesToggle && gamifyBadges) {
    gamifyBadgesToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      gamifyBadges.hidden = !gamifyBadges.hidden;
      if (!gamifyBadges.hidden && window.LexPrepMotion) LexPrepMotion.stagger(gamifyBadges, '.gamify-badge');
    });
    document.addEventListener('click', (e) => {
      if (!gamifyBadges.hidden && !gamifyBadges.contains(e.target) && e.target !== gamifyBadgesToggle) {
        gamifyBadges.hidden = true;
      }
    });
  }

  buildCardQueue(false);
  renderSelectors();
  renderContent();
  renderGamifyBar();
}

