document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

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

  const disciplineList = document.getElementById('disciplineList');
  const topicList = document.getElementById('topicList');
  const contentView = document.getElementById('contentView');

  if (!disciplineList || !topicList || !contentView) return;

  let activeDiscipline = DATA[0];
  let activeTopic = DATA[0].topics[0];
  let activeView = 'notes';
  let cardQueue = [];
  let cardPos = 0;
  let cardFlipped = false;
  let searchQuery = '';

  function buildCardQueue(forceAll) {
    const cards = activeTopic.cards || [];
    cardQueue = forceAll
      ? cards.map((_, i) => i)
      : LexPrepProgress.getDueCardIndexes(activeTopic.id, cards);
    cardPos = 0;
    cardFlipped = false;
  }

  function selectTopic(discipline, topic) {
    activeDiscipline = discipline;
    activeTopic = topic;
    activeView = 'notes';
    buildCardQueue(false);
    searchQuery = '';
    const searchInput = document.getElementById('topicSearch');
    if (searchInput) searchInput.value = '';
    renderDisciplines();
    renderTopics();
    renderContent();
    enableFocusMode();
  }

  function renderDisciplines() {
    if (searchQuery) {
      const q = searchQuery;
      const matches = [];
      DATA.forEach(d => {
        d.topics.forEach(t => {
          const haystack = `${t.title} ${t.description}`.toLowerCase();
          if (haystack.includes(q)) matches.push({ discipline: d, topic: t });
        });
      });

      disciplineList.innerHTML = matches.length
        ? matches.map(m => `
            <button class="item-btn search-result-btn" data-discipline="${m.discipline.id}" data-topic="${m.topic.id}">
              <span class="search-result-btn__topic">${escapeHtml(m.topic.title)}</span>
              <span class="search-result-btn__discipline">${escapeHtml(m.discipline.title)}</span>
            </button>
          `).join('')
        : `<p class="topic-desc">Ничего не найдено.</p>`;

      disciplineList.querySelectorAll('[data-topic]').forEach(btn => {
        btn.addEventListener('click', () => {
          const discipline = DATA.find(d => d.id === btn.dataset.discipline);
          const topic = discipline.topics.find(t => t.id === btn.dataset.topic);
          selectTopic(discipline, topic);
        });
      });
      return;
    }

    disciplineList.innerHTML = DATA.map(d => `
      <button class="item-btn ${d.id === activeDiscipline.id ? 'is-active' : ''}" data-discipline="${d.id}">
        ${escapeHtml(d.title)}
      </button>
    `).join('');

    disciplineList.querySelectorAll('[data-discipline]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeDiscipline = DATA.find(d => d.id === btn.dataset.discipline);
        activeTopic = activeDiscipline.topics[0];
        activeView = 'notes';
        buildCardQueue(false);
        renderDisciplines();
        renderTopics();
        renderContent();
      });
    });
  }

  function renderTopics() {
    topicList.innerHTML = activeDiscipline.topics.map(t => `
      <button class="item-btn ${t.id === activeTopic.id ? 'is-active' : ''}" data-topic="${t.id}">
        ${escapeHtml(t.title)}
      </button>
    `).join('');

    topicList.querySelectorAll('[data-topic]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTopic = activeDiscipline.topics.find(t => t.id === btn.dataset.topic);
        activeView = 'notes';
        buildCardQueue(false);
        renderTopics();
        renderContent();
        enableFocusMode();
      });
    });
  }

  function renderContent() {
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
        <button class="topic-tab ${activeView === 'test' ? 'is-active' : ''}" type="button" data-view="test">Тест</button>
        <button class="topic-tab ${activeView === 'practice' ? 'is-active' : ''}" type="button" data-view="practice">Практика ВС РФ</button>
        <button class="topic-tab ${activeView === 'notepad' ? 'is-active' : ''}" type="button" data-view="notepad">Мои заметки</button>
      </div>

      <div data-view-panel="notes" ${activeView === 'notes' ? '' : 'hidden'}>
        ${activeTopic.theory}
      </div>

      <div class="flashcards" data-view-panel="cards" ${activeView === 'cards' ? '' : 'hidden'}>
        ${activeTopic.cards && activeTopic.cards.length ? `
          <div class="flashcards__meta">
            <span class="flashcards__due" id="cardsDueLabel"></span>
            <button class="btn btn--ghost" type="button" id="reviewAllBtn">Повторить всё</button>
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
        <h2 class="test-box__title">Тест по теме</h2>
        <div id="questionsWrap">
          ${activeTopic.test.map((q, qIndex) => `
            <div class="question" data-question="${qIndex}">
              <h4>${qIndex + 1}. ${escapeHtml(q.question)}</h4>
              <div class="answers">
                ${q.options.map((option, i) => `
                  <label class="answer">
                    <input type="radio" name="q-${qIndex}" value="${i}">
                    <span>${escapeHtml(option)}</span>
                  </label>
                `).join('')}
              </div>
              <div class="question-result" id="result-${qIndex}"></div>
            </div>
          `).join('')}
        </div>

        <div class="test-actions">
          <button class="btn btn--primary" id="checkTestBtn">Проверить ответы</button>
        </div>

        <div class="summary" id="summaryBox"></div>
      </div>
    `;

    const checkBtn = document.getElementById('checkTestBtn');

    contentView.querySelectorAll('[data-view]').forEach(tab => {
      tab.addEventListener('click', () => {
        activeView = tab.dataset.view;
        renderContent();
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

    if (checkBtn) {
      checkBtn.addEventListener('click', () => {
        let score = 0;
        const wrongIndexes = [];

        activeTopic.test.forEach((q, qIndex) => {
          const chosen = document.querySelector(`input[name="q-${qIndex}"]:checked`);
          const resultBox = document.getElementById(`result-${qIndex}`);

          if (!chosen) {
            resultBox.className = 'question-result is-wrong';
            resultBox.innerHTML = `Ответ не выбран.<br>Правильный ответ: <strong>${escapeHtml(q.options[q.correct])}</strong>.<br>${escapeHtml(q.explanation)}`;
            wrongIndexes.push(qIndex);
            return;
          }

          const chosenIndex = Number(chosen.value);

          if (chosenIndex === q.correct) {
            score++;
            resultBox.className = 'question-result is-correct';
            resultBox.innerHTML = `Верно.<br><strong>Почему:</strong> ${escapeHtml(q.explanation)}`;
          } else {
            resultBox.className = 'question-result is-wrong';
            resultBox.innerHTML = `
              Неверно.<br>
              <strong>Твой ответ:</strong> ${escapeHtml(q.options[chosenIndex])}<br>
              <strong>Правильный ответ:</strong> ${escapeHtml(q.options[q.correct])}<br>
              <strong>Почему не так:</strong> ${escapeHtml(q.explanation)}
            `;
            wrongIndexes.push(qIndex);
          }
        });

        const summaryBox = document.getElementById('summaryBox');
        const total = activeTopic.test.length;
        const percent = Math.round((score / total) * 100);

        LexPrepProgress.recordTestAttempt(activeTopic.id, score, total, wrongIndexes);

        summaryBox.classList.add('is-visible');
        summaryBox.innerHTML = `
          <h3>Итог теста</h3>
          <p>Правильных ответов: <strong>${score}</strong> из <strong>${total}</strong>.</p>
          <p>Результат: <strong>${percent}%</strong>.</p>
          <p class="summary__note">Если результат ниже 70%, лучше ещё раз пройти теорию и затем перепройти тест.</p>
        `;

        summaryBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
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
      status.textContent = '';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const allNotes = getNotes();
        allNotes[activeTopic.id] = textarea.value;
        localStorage.setItem('lexprep_notes', JSON.stringify(allNotes));
        status.textContent = '✓ Сохранено';
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
      ${!cardFlipped ? `
        <p class="flashcard-hint">Нажми на карточку, чтобы перевернуть · ${cardPos + 1} из ${cardQueue.length}</p>
      ` : `
        <p class="flashcard-hint">Оцени, знал(а) ли ты ответ</p>
        <div class="flashcard-grade">
          <button class="btn btn--outline" type="button" id="gradeWrongBtn">😕 Не знал(а)</button>
          <button class="btn btn--primary" type="button" id="gradeRightBtn">✅ Знал(а)</button>
        </div>
      `}
    `;

    const flashcard = document.getElementById('flashcard');
    flashcard.addEventListener('click', () => {
      cardFlipped = !cardFlipped;
      renderCardSession();
    });

    const gradeWrongBtn = document.getElementById('gradeWrongBtn');
    const gradeRightBtn = document.getElementById('gradeRightBtn');

    function grade(correct) {
      LexPrepProgress.reviewCard(activeTopic.id, cardIndex, correct);
      cardPos++;
      cardFlipped = false;
      renderCardSession();
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

  const appLayout = document.getElementById('appLayout');

  function animateFocusMode(collapse) {
    if (!appLayout) return;

    const startColumns = getComputedStyle(appLayout).gridTemplateColumns;
    appLayout.classList.toggle('is-focus-mode', collapse);
    const endColumns = getComputedStyle(appLayout).gridTemplateColumns;

    if (startColumns === endColumns) return;

    appLayout.style.transition = 'none';
    appLayout.style.gridTemplateColumns = startColumns;
    appLayout.getBoundingClientRect();

    requestAnimationFrame(() => {
      appLayout.style.transition = 'grid-template-columns 0.5s cubic-bezier(0.65, 0, 0.35, 1)';
      appLayout.style.gridTemplateColumns = endColumns;
    });

    appLayout.addEventListener('transitionend', function handler(e) {
      if (e.propertyName !== 'grid-template-columns') return;
      appLayout.style.transition = '';
      appLayout.style.gridTemplateColumns = '';
      appLayout.removeEventListener('transitionend', handler);
    });
  }

  function enableFocusMode() {
    animateFocusMode(true);
  }

  function disableFocusMode() {
    animateFocusMode(false);
  }

  document.querySelectorAll('[data-toggle-panel]').forEach(button => {
    button.addEventListener('click', disableFocusMode);
  });

  const searchInput = document.getElementById('topicSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderDisciplines();
    });
  }

  buildCardQueue(false);
  renderDisciplines();
  renderTopics();
  renderContent();
}

