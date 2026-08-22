document.addEventListener('DOMContentLoaded', async () => {
  await (window.LexPrepContentReady || Promise.resolve());
  initApp();
  initAiChat();
});

/* ---------------- AI consultant chat widget ----------------
   Реальные ответы идут через Edge Function ai-consultant (NVIDIA API,
   ключ только на сервере) — доступ только на тарифах pro/max, лимит в
   день сервер проверяет сам. Здесь только UI + история для контекста. */
function initAiChat() {
  const toggle = document.getElementById('aiChatToggle');
  const panel = document.getElementById('aiChatPanel');
  const closeBtn = document.getElementById('aiChatClose');
  const form = document.getElementById('aiChatForm');
  const input = document.getElementById('aiChatInput');
  const body = document.getElementById('aiChatBody');
  if (!toggle || !panel || !form || !input || !body) return;

  const history = [];
  let sending = false;

  function open() {
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

  function addMessage(text, who) {
    const msg = document.createElement('div');
    msg.className = `ai-chat__msg ai-chat__msg--${who}`;
    msg.textContent = text;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
    return msg;
  }

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

    addMessage(text, 'user');
    input.value = '';
    sending = true;
    const pending = addMessage('Печатает…', 'bot');

    try {
      const result = await LexPrepApi.askAiConsultant(text, history);
      pending.textContent = result.reply;
      history.push({ role: 'user', content: text }, { role: 'assistant', content: result.reply });
      if (typeof result.remaining === 'number' && result.remaining <= 2) {
        addMessage(`Осталось запросов сегодня: ${result.remaining} из ${result.limit}.`, 'bot');
      }
    } catch (err) {
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
  let voiceAnswerResult = null;
  let searchQuery = '';

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

  function getUserTests() {
    return JSON.parse(localStorage.getItem('lexprep_user_tests') || '[]');
  }

  function buildCardQueue(forceAll) {
    const cards = activeTopic.cards || [];
    cardQueue = forceAll
      ? cards.map((_, i) => i)
      : LexPrepProgress.getDueCardIndexes(activeTopic.id, cards);
    cardPos = 0;
    cardFlipped = false;
    voiceAnswerResult = null;
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
  }

  // Дисциплина и тема — два выпадающих списка над контентом (а не
  // постоянные боковые колонки): так контент всегда занимает всё окно,
  // а переключение темы не сворачивает/разворачивает соседние панели.
  function renderSelectors() {
    disciplineSelectValue.textContent = activeDiscipline.title;
    disciplineSelectMenu.innerHTML = DATA.map(d => {
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
    topicSelectMenu.innerHTML = activeDiscipline.topics.map(t => {
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
  }

  function renderContent(animate) {
    if (animate === undefined) animate = true;
    contentView.classList.remove('content-fade-in');

    if (LexPrepPlan.isDisciplineLocked(activeDiscipline.id, DATA)) {
      contentView.innerHTML = `
        <div class="breadcrumbs">
          <span>LexPrep</span>
          <span>→</span>
          <span>${escapeHtml(activeDiscipline.title)}</span>
          <span>→</span>
          <span>${escapeHtml(activeTopic.title)}</span>
        </div>

        <h1 class="topic-title">${escapeHtml(activeTopic.title)}</h1>

        <div class="paywall">
          <div class="paywall__badge">Тариф «Про»</div>
          <h2 class="paywall__title">Эта дисциплина закрыта на Базовом тарифе</h2>
          <p class="paywall__text">
            На Базовом тарифе полностью открыта только одна дисциплина (её можно выбрать в настройках профиля) — у остальных виден только список тем, без конспекта, тестов и карточек.
            Оформи «Про» или «Максимум», чтобы открыть все дисциплины без ограничений.
          </p>
          <a class="btn btn--primary" href="index.html#pricing">Смотреть тарифы</a>
        </div>
      `;
      if (animate) {
        void contentView.offsetWidth;
        contentView.classList.add('content-fade-in');
      }
      return;
    }

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

      <div class="topic-tabs">
        <button class="topic-tab ${activeView === 'notes' ? 'is-active' : ''}" type="button" data-view="notes">Конспект</button>
        <button class="topic-tab ${activeView === 'cards' ? 'is-active' : ''}" type="button" data-view="cards">Карточки</button>
        <button class="topic-tab ${activeView === 'test' ? 'is-active' : ''}" type="button" data-view="test">Тесты</button>
        <button class="topic-tab ${activeView === 'practice' ? 'is-active' : ''}" type="button" data-view="practice">${activeDiscipline.id === 'constitutional' ? 'Практика КС РФ' : 'Практика ВС РФ'}</button>
        <button class="topic-tab ${activeView === 'notepad' ? 'is-active' : ''}" type="button" data-view="notepad">Мои заметки</button>
        ${LexPrepPlan.getLimits().pdfExport ? '<button class="topic-tab topic-tab--pdf" type="button" id="downloadPdfBtn">Скачать PDF</button>' : ''}
      </div>

      <div data-view-panel="notes" ${activeView === 'notes' ? '' : 'hidden'}>
        ${activeTopic.theory}
      </div>

      <div class="flashcards" data-view-panel="cards" ${activeView === 'cards' ? '' : 'hidden'}>
        ${activeTopic.cards && activeTopic.cards.length ? `
          <div class="flashcards__meta">
            <span class="flashcards__due" id="cardsDueLabel"></span>
            <div class="flashcards__meta-actions">
              <div class="mode-toggle" role="tablist" aria-label="Режим тренировки">
                <button class="mode-toggle__btn ${cardMode === 'text' ? 'is-active' : ''}" type="button" data-mode="text">Текст</button>
                <button class="mode-toggle__btn ${cardMode === 'voice' ? 'is-active' : ''}" type="button" data-mode="voice">Голос</button>
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
    `;

    if (animate) {
      void contentView.offsetWidth;
      contentView.classList.add('content-fade-in');
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
    const { jsPDF } = jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginX = 48;
    const marginTop = 56;
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = doc.internal.pageSize.getWidth() - marginX * 2;
    let y = marginTop;

    function addLine(text, fontSize, isBold) {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      const lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach(line => {
        if (y > pageHeight - marginTop) {
          doc.addPage();
          y = marginTop;
        }
        doc.text(line, marginX, y);
        y += fontSize * 1.35;
      });
    }

    addLine(topic.title, 16, true);
    y += 8;

    const container = document.createElement('div');
    container.innerHTML = topic.theory || '';
    container.querySelectorAll('h1, h2, h3, h4, p, li, tr').forEach(el => {
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      if (!text) return;
      const isHeading = /^H[1-4]$/.test(el.tagName);
      if (isHeading) y += 6;
      addLine(text, isHeading ? 13 : 11, isHeading);
      if (isHeading) y += 2;
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
        <button class="btn btn--primary" type="button" data-check-test>Проверить ответы</button>
      </div>

      <div class="summary" data-summary-box></div>
    `;

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

      summaryBox.classList.add('is-visible');
      summaryBox.innerHTML = `
        <h3>Итог теста</h3>
        <p>Правильных ответов: <strong>${score}</strong> из <strong>${total}</strong>.</p>
        <p>Результат: <strong>${percent}%</strong>.</p>
        <p class="summary__note">Если результат ниже 70%, лучше ещё раз пройти теорию и затем перепройти тест. В вопросах с несколькими вариантами засчитывается только полностью верный набор ответов.</p>
      `;

      summaryBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function renderUserTestsList() {
    const listEl = document.getElementById('userTestsList');
    if (!listEl) return;

    const tests = getUserTests()
      .filter(t => t.topicId === activeTopic.id)
      .sort((a, b) => b.createdAt - a.createdAt);

    if (!tests.length) {
      listEl.innerHTML = '<p class="topic-desc">Пока нет пользовательских тестов по этой теме — стань первым, кто его создаст.</p>';
      initTestAccordion();
      return;
    }

    listEl.innerHTML = tests.map(test => `
      <div class="test-card">
        <button class="test-card__head" type="button" data-test-toggle="${test.id}">
          <span class="test-card__author">
            <span class="test-card__avatar">${escapeHtml((test.author || 'U').trim().charAt(0).toUpperCase())}</span>
            <span class="test-card__author-info">
              <span class="test-card__author-line">${escapeHtml(test.author || 'Аноним')} <span class="test-card__level">Ур. ${test.authorLevel || 1}</span></span>
              <span class="test-card__title">${escapeHtml(test.title)}</span>
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
          if (test) renderTestQuestions(body, test.questions, `${test.topicId}::user::${test.id}`);
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
      <div class="flashcard" id="flashcard">
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
          <p class="flashcard-hint">Ответь голосом или текстом — черновая проверка подскажет, близко ли ты к ответу</p>
          <div class="voice-trainer__row">
            <button class="btn btn--outline voice-mic-btn" type="button" id="voiceMicBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>
              <span id="voiceMicLabel">Записать ответ</span>
            </button>
            <input type="text" class="form-input voice-trainer__input" id="voiceAnswerInput" placeholder="Или впиши ответ своими словами">
          </div>
          <div class="voice-trainer__actions">
            <button class="btn btn--primary" type="button" id="voiceCheckBtn">Проверить</button>
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
        <p class="flashcard-hint">Нажми на карточку, чтобы перевернуть · ${cardPos + 1} из ${cardQueue.length}</p>
      ` : `
        <p class="flashcard-hint">Оцени, знал(а) ли ты ответ</p>
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

    const flashcard = document.getElementById('flashcard');
    flashcard.addEventListener('click', () => {
      cardFlipped = !cardFlipped;
      voiceAnswerResult = null;
      renderCardSession();
    });

    const voiceAnswerInput = document.getElementById('voiceAnswerInput');
    const voiceMicBtn = document.getElementById('voiceMicBtn');
    const voiceMicLabel = document.getElementById('voiceMicLabel');
    const voiceCheckBtn = document.getElementById('voiceCheckBtn');

    if (voiceMicBtn) {
      const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognitionCtor) {
        voiceMicBtn.disabled = true;
        voiceMicLabel.textContent = 'Голосовой ввод не поддерживается в этом браузере';
      } else {
        voiceMicBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const recognition = new SpeechRecognitionCtor();
          recognition.lang = 'ru-RU';
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;

          voiceMicBtn.classList.add('is-recording');
          voiceMicLabel.textContent = 'Слушаю...';

          recognition.addEventListener('result', (event) => {
            const transcript = event.results[0][0].transcript;
            if (voiceAnswerInput) voiceAnswerInput.value = transcript;
          });
          recognition.addEventListener('end', () => {
            voiceMicBtn.classList.remove('is-recording');
            voiceMicLabel.textContent = 'Записать ответ';
          });
          recognition.addEventListener('error', () => {
            voiceMicBtn.classList.remove('is-recording');
            voiceMicLabel.textContent = 'Записать ответ';
          });

          recognition.start();
        });
      }
    }

    if (voiceCheckBtn) {
      voiceCheckBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const answer = voiceAnswerInput ? voiceAnswerInput.value : '';
        voiceAnswerResult = checkVoiceAnswer(answer, card.back);
        renderCardSession();
      });
    }

    const gradeWrongBtn = document.getElementById('gradeWrongBtn');
    const gradeRightBtn = document.getElementById('gradeRightBtn');

    function grade(correct) {
      LexPrepProgress.reviewCard(activeTopic.id, cardIndex, correct);
      renderGamifyBar();
      flashcard.classList.add(correct ? 'flashcard--correct' : 'flashcard--wrong');
      if (gradeWrongBtn) gradeWrongBtn.disabled = true;
      if (gradeRightBtn) gradeRightBtn.disabled = true;
      setTimeout(() => {
        cardPos++;
        cardFlipped = false;
        voiceAnswerResult = null;
        renderCardSession();
        renderSelectors();
      }, 260);
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
    disciplineSelectMenu.hidden = !willOpen;
  });
  disciplineSelectMenu.addEventListener('click', (e) => e.stopPropagation());

  topicSelectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = topicSelectMenu.hidden;
    closeSelectMenus();
    topicSelectMenu.hidden = !willOpen;
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

  function renderGamifyBar() {
    const bar = document.getElementById('gamifyBar');
    if (!bar || typeof LexPrepProgress.getGamification !== 'function') return;

    const g = LexPrepProgress.getGamification();
    document.getElementById('gamifyLevel').querySelector('.gamify-bar__level-num').textContent = g.level;
    document.getElementById('gamifyTitle').textContent = g.rankName;
    document.getElementById('gamifyXp').textContent = `${g.xpIntoLevel} / ${g.xpForNextLevel} XP`;
    document.getElementById('gamifyFill').style.width = `${g.progressPercent}%`;
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

