document.addEventListener('DOMContentLoaded', () => {
  initApp();
  initAiChat();
});

/* ---------------- AI consultant chat widget (demo UI, no real AI wired up yet) ---------------- */
function initAiChat() {
  const toggle = document.getElementById('aiChatToggle');
  const panel = document.getElementById('aiChatPanel');
  const closeBtn = document.getElementById('aiChatClose');
  const form = document.getElementById('aiChatForm');
  const input = document.getElementById('aiChatInput');
  const body = document.getElementById('aiChatBody');
  if (!toggle || !panel || !form || !input || !body) return;

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

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    const userMsg = document.createElement('div');
    userMsg.className = 'ai-chat__msg ai-chat__msg--user';
    userMsg.textContent = text;
    body.appendChild(userMsg);
    input.value = '';

    setTimeout(() => {
      const botMsg = document.createElement('div');
      botMsg.className = 'ai-chat__msg ai-chat__msg--bot';
      botMsg.textContent = 'Спасибо за вопрос! Живой ИИ-консультант ещё не подключён — это демо интерфейса, реальные ответы появятся, когда мы включим его на бэкенде.';
      body.appendChild(botMsg);
      body.scrollTop = body.scrollHeight;
    }, 450);

    body.scrollTop = body.scrollHeight;
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

  function buildCardQueue(forceAll) {
    const cards = activeTopic.cards || [];
    cardQueue = forceAll
      ? cards.map((_, i) => i)
      : LexPrepProgress.getDueCardIndexes(activeTopic.id, cards);
    cardPos = 0;
    cardFlipped = false;
    voiceAnswerResult = null;
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

    disciplineList.innerHTML = DATA.map(d => {
      const progress = LexPrepProgress.getDisciplineProgress(d);
      return `
      <button class="item-btn ${d.id === activeDiscipline.id ? 'is-active' : ''}" data-discipline="${d.id}">
        ${escapeHtml(d.title)}
        <span class="item-progress">
          <span class="item-progress__track"><span class="item-progress__fill" style="width: ${progress}%"></span></span>
          <span class="item-progress__label">${progress}%</span>
        </span>
      </button>
    `;
    }).join('');

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
    topicList.innerHTML = activeDiscipline.topics.map(t => {
      const progress = LexPrepProgress.getTopicProgress(t.id, t);
      return `
      <button class="item-btn ${t.id === activeTopic.id ? 'is-active' : ''}" data-topic="${t.id}">
        ${escapeHtml(t.title)}
        <span class="item-progress">
          <span class="item-progress__track"><span class="item-progress__fill" style="width: ${progress}%"></span></span>
          <span class="item-progress__label">${progress}%</span>
        </span>
      </button>
    `;
    }).join('');

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
        renderTopics();
        renderDisciplines();
        renderGamifyBar();

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
        renderTopics();
        renderDisciplines();
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

  function renderGamifyBar() {
    const bar = document.getElementById('gamifyBar');
    if (!bar || typeof LexPrepProgress.getGamification !== 'function') return;

    const g = LexPrepProgress.getGamification(DATA);
    document.getElementById('gamifyLevel').querySelector('.gamify-bar__level-num').textContent = g.level;
    document.getElementById('gamifyTitle').textContent = g.levelTitle;
    document.getElementById('gamifyXp').textContent = `${g.xpIntoLevel} / ${g.xpForNextLevel} XP`;
    document.getElementById('gamifyFill').style.width = `${g.progressPercent}%`;

    const earnedCount = g.badges.filter(b => b.earned).length;
    document.getElementById('gamifyBadgesCount').textContent = `${earnedCount}/${g.badges.length}`;

    document.getElementById('gamifyBadges').innerHTML = g.badges.map(b => `
      <div class="gamify-badge ${b.earned ? 'is-earned' : ''}">
        <span class="gamify-badge__title">${escapeHtml(b.title)}</span>
        <span class="gamify-badge__desc">${escapeHtml(b.desc)}</span>
      </div>
    `).join('');
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
  renderDisciplines();
  renderTopics();
  renderContent();
  renderGamifyBar();
}

