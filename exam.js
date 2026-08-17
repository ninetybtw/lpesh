/* ==========================================================================
EXAM.JS — режим «Пробный экзамен»: случайный билет по выбранным дисциплинам,
таймер, разбор ответов и повтор слабых мест.
========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  await (window.LexPrepContentReady || Promise.resolve());
  initExam();
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sameAnswerSet(a, b) {
  if (!a || !a.length || a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function initExam() {
  const DATA = LEXPREP_DATA;
  const views = document.querySelectorAll('[data-exam-view]');

  function showView(name) {
    views.forEach(v => { v.hidden = v.dataset.examView !== name; });
  }

  function disciplineOf(topicId) {
    return DATA.find(d => d.topics.some(t => t.id === topicId));
  }

  function buildPool(disciplineFilter) {
    const pool = [];
    DATA.forEach(d => {
      if (disciplineFilter !== 'all' && d.id !== disciplineFilter) return;
      d.topics.forEach(t => {
        t.test.forEach((q, qIndex) => {
          pool.push({ topicId: t.id, topicTitle: t.title, disciplineTitle: d.title, qIndex, question: LexPrepProgress.normalizeQuestion(q) });
        });
      });
    });
    return pool;
  }

  function pickQuestions(count, weakFirst, disciplineFilter) {
    const pool = buildPool(disciplineFilter);
    const used = new Set();
    const selected = [];

    if (weakFirst) {
      const weak = LexPrepProgress.getWeakQuestions(DATA);
      weak.forEach(w => {
        if (disciplineFilter !== 'all') {
          const d = disciplineOf(w.topicId);
          if (!d || d.id !== disciplineFilter) return;
        }
        const key = `${w.topicId}::${w.qIndex}`;
        if (!used.has(key) && selected.length < count) {
          const d = disciplineOf(w.topicId);
          selected.push({ topicId: w.topicId, topicTitle: w.topicTitle, disciplineTitle: d ? d.title : '', qIndex: w.qIndex, question: w.question });
          used.add(key);
        }
      });
    }

    const rest = shuffle(pool.filter(item => !used.has(`${item.topicId}::${item.qIndex}`)));
    for (const item of rest) {
      if (selected.length >= count) break;
      selected.push(item);
      used.add(`${item.topicId}::${item.qIndex}`);
    }

    return selected;
  }

  /* ---------------- Setup screen ---------------- */
  const disciplineSelect = document.getElementById('examDiscipline');
  disciplineSelect.innerHTML = `<option value="all">Все дисциплины</option>` +
    DATA.map(d => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('');

  const weakCount = LexPrepProgress.getWeakQuestions(DATA).length;
  const weakHint = document.getElementById('weakHint');
  weakHint.textContent = weakCount
    ? `Найдено слабых мест: ${weakCount}. Они будут в начале билета.`
    : 'Слабых мест пока не отмечено — пройди пару тестов в тренажёре, и здесь появится персональная подборка.';

  document.getElementById('startExamBtn').addEventListener('click', () => {
    const count = Number(document.getElementById('examCount').value);
    const weakFirst = document.getElementById('examWeakFirst').checked;
    const disciplineFilter = disciplineSelect.value;
    const secondsPerQuestion = Number(document.getElementById('examTime').value);

    const questions = pickQuestions(count, weakFirst, disciplineFilter);
    if (!questions.length) {
      alert('Не удалось собрать вопросы — попробуй выбрать другую дисциплину.');
      return;
    }
    startExam(questions, secondsPerQuestion);
  });

  /* ---------------- Running screen ---------------- */
  let examQuestions = [];
  let examAnswers = [];
  let currentIndex = 0;
  let timerInterval = null;
  let secondsLeft = 0;

  const progressEl = document.getElementById('examProgress');
  const timerEl = document.getElementById('examTimer');
  const topicLabelEl = document.getElementById('examTopicLabel');
  const questionBox = document.getElementById('examQuestionBox');
  const prevBtn = document.getElementById('examPrevBtn');
  const nextBtn = document.getElementById('examNextBtn');
  const finishBtn = document.getElementById('examFinishBtn');

  function startExam(questions, secondsPerQuestion) {
    examQuestions = questions;
    examAnswers = new Array(questions.length).fill(null);
    currentIndex = 0;
    showView('running');
    renderQuestion();

    clearInterval(timerInterval);
    if (secondsPerQuestion > 0) {
      secondsLeft = secondsPerQuestion * questions.length;
      updateTimerDisplay();
      timerInterval = setInterval(() => {
        secondsLeft--;
        updateTimerDisplay();
        if (secondsLeft <= 0) {
          clearInterval(timerInterval);
          finishExam();
        }
      }, 1000);
    } else {
      timerEl.textContent = 'без ограничения';
    }
  }

  function updateTimerDisplay() {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    timerEl.classList.toggle('is-low', secondsLeft <= 30);
  }

  function renderQuestion() {
    const item = examQuestions[currentIndex];
    const isMulti = item.question.correct.length > 1;
    const chosen = examAnswers[currentIndex] || [];
    progressEl.textContent = `Вопрос ${currentIndex + 1} из ${examQuestions.length}`;
    topicLabelEl.textContent = `${item.disciplineTitle} → ${item.topicTitle}`;

    questionBox.innerHTML = `
      <h4>${escapeHtml(item.question.question)}</h4>
      ${isMulti ? '<p class="question--multi__hint">Выбери все подходящие варианты</p>' : ''}
      <div class="answers">
        ${item.question.options.map((option, i) => `
          <label class="answer">
            <input type="${isMulti ? 'checkbox' : 'radio'}" name="exam-answer" value="${i}" ${chosen.includes(i) ? 'checked' : ''}>
            <span>${escapeHtml(option)}</span>
          </label>
        `).join('')}
      </div>
    `;

    questionBox.querySelectorAll('input[name="exam-answer"]').forEach(input => {
      input.addEventListener('change', () => {
        examAnswers[currentIndex] = Array.from(questionBox.querySelectorAll('input[name="exam-answer"]:checked')).map(el => Number(el.value));
      });
    });

    prevBtn.disabled = currentIndex === 0;
    nextBtn.textContent = currentIndex === examQuestions.length - 1 ? 'Завершить экзамен' : 'Далее →';
  }

  prevBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
      currentIndex--;
      renderQuestion();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (currentIndex < examQuestions.length - 1) {
      currentIndex++;
      renderQuestion();
    } else {
      finishExam();
    }
  });

  finishBtn.addEventListener('click', () => {
    if (confirm('Завершить экзамен досрочно? Неотвеченные вопросы будут засчитаны как неверные.')) {
      finishExam();
    }
  });

  /* ---------------- Results screen ---------------- */
  let lastWrongQuestions = [];

  function finishExam() {
    clearInterval(timerInterval);

    let score = 0;
    const wrongEntries = [];
    const wrongQuestions = [];
    const breakdown = {}; // topicId -> {title, correct, total}

    examQuestions.forEach((item, i) => {
      const chosen = examAnswers[i];
      const isCorrect = sameAnswerSet(chosen, item.question.correct);
      if (isCorrect) score++;
      else {
        wrongQuestions.push({ ...item, chosen });
      }
      wrongEntries.push({ topicId: item.topicId, qIndex: item.qIndex, correct: isCorrect });

      if (!breakdown[item.topicId]) {
        breakdown[item.topicId] = { title: item.topicTitle, correct: 0, total: 0 };
      }
      breakdown[item.topicId].total++;
      if (isCorrect) breakdown[item.topicId].correct++;
    });

    const total = examQuestions.length;
    const uniqueTopics = Array.from(new Set(examQuestions.map(q => q.topicId)));
    LexPrepProgress.recordExamAttempt(score, total, uniqueTopics, wrongEntries);

    lastWrongQuestions = wrongQuestions;
    renderResults(score, total, breakdown, wrongQuestions);
    showView('results');
  }

  function renderResults(score, total, breakdown, wrongQuestions) {
    const percent = Math.round((score / total) * 100);
    document.getElementById('examScoreTitle').textContent = `${score} из ${total} — ${percent}%`;
    document.getElementById('examScoreMsg').textContent = percent >= 70
      ? 'Хороший результат — можно закреплять карточками и двигаться дальше.'
      : 'Есть, над чем поработать — загляни в конспект по темам ниже и повтори слабые вопросы.';

    const breakdownEl = document.getElementById('examBreakdown');
    breakdownEl.innerHTML = Object.values(breakdown).map(b => `
      <div class="results-row">
        <span class="results-row__topic">${escapeHtml(b.title)}</span>
        <span class="results-row__score ${b.correct === b.total ? 'results-row__score--good' : b.correct / b.total >= 0.6 ? 'results-row__score--mid' : 'results-row__score--bad'}">${b.correct} / ${b.total}</span>
      </div>
    `).join('');

    const reviewEl = document.getElementById('examReview');
    if (!wrongQuestions.length) {
      reviewEl.innerHTML = `<p class="topic-desc">Все ответы верные — разбирать нечего.</p>`;
    } else {
      reviewEl.innerHTML = wrongQuestions.map(item => {
        const chosenText = item.chosen && item.chosen.length
          ? item.chosen.map(i => item.question.options[i]).join('; ')
          : 'не выбран';
        const correctText = item.question.correct.map(i => item.question.options[i]).join('; ');
        return `
        <div class="question">
          <h4>${escapeHtml(item.topicTitle)}: ${escapeHtml(item.question.question)}</h4>
          <div class="question-result is-wrong">
            <strong>Твой ответ:</strong> ${escapeHtml(chosenText)}<br>
            <strong>Правильный ответ:</strong> ${escapeHtml(correctText)}<br>
            <strong>Почему:</strong> ${escapeHtml(item.question.explanation)}
          </div>
        </div>
      `;
      }).join('');
    }

    const retryBtn = document.getElementById('retryWeakBtn');
    retryBtn.hidden = wrongQuestions.length === 0;
  }

  document.getElementById('retryWeakBtn').addEventListener('click', () => {
    if (!lastWrongQuestions.length) return;
    startExam(lastWrongQuestions.map(({ chosen, ...rest }) => rest), 90);
  });

  showView('setup');
}
