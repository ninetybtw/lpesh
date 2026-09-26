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

// «1 вопрос», «3 вопроса», «15 вопросов».
function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function examIcon(name) {
  return typeof LexPrepIcon === 'function'
    ? LexPrepIcon(name)
    : `<img class="lp-icon" src="assets/icons/${name}.svg" alt="" aria-hidden="true" />`;
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function initExam() {
  const DATA = LEXPREP_DATA;
  const views = document.querySelectorAll('[data-exam-view]');
  const motion = window.LexPrepMotion;
  const reduced = () => (motion ? motion.reduced() : false);

  function showView(name) {
    views.forEach(v => {
      const show = v.dataset.examView === name;
      v.hidden = !show;
      if (show && !reduced()) {
        v.classList.remove('is-entering');
        void v.offsetWidth;
        v.classList.add('is-entering');
      }
    });
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
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

  function weakFor(disciplineFilter) {
    return LexPrepProgress.getWeakQuestions(DATA).filter(w => {
      if (disciplineFilter === 'all') return true;
      const d = disciplineOf(w.topicId);
      return d && d.id === disciplineFilter;
    });
  }

  function pickQuestions(count, weakFirst, disciplineFilter) {
    const pool = buildPool(disciplineFilter);
    const used = new Set();
    const selected = [];

    if (weakFirst) {
      weakFor(disciplineFilter).forEach(w => {
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
  const countSelect = document.getElementById('examCount');
  const timeSelect = document.getElementById('examTime');
  const weakCheckbox = document.getElementById('examWeakFirst');
  const weakHint = document.getElementById('weakHint');
  const ticketEl = document.getElementById('examTicket');

  disciplineSelect.innerHTML = `<option value="all">Все дисциплины</option>` +
    DATA.map(d => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('');

  // Кнопки-сегменты управляют скрытыми select'ами (их значения читает логика ниже).
  document.querySelectorAll('[data-seg-for]').forEach(seg => {
    const select = document.getElementById(seg.dataset.segFor);
    const sync = () => {
      seg.querySelectorAll('[data-value]').forEach(btn => {
        const on = btn.dataset.value === select.value;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    };
    seg.querySelectorAll('[data-value]').forEach(btn => {
      btn.addEventListener('click', () => {
        select.value = btn.dataset.value;
        sync();
        updateTicket(true);
      });
    });
    sync();
  });

  document.getElementById('ticketNumber').textContent = 1 + Math.floor(Math.random() * 60);

  function updateTicket(bump) {
    const count = Number(countSelect.value);
    const seconds = Number(timeSelect.value);
    const discipline = DATA.find(d => d.id === disciplineSelect.value);
    const weak = weakFor(disciplineSelect.value).length;

    document.getElementById('ticketDiscipline').textContent = discipline ? discipline.title : 'Все дисциплины';
    document.getElementById('ticketCount').textContent = `${count} ${plural(count, 'вопрос', 'вопроса', 'вопросов')}`;
    document.getElementById('ticketTime').textContent = seconds
      ? `≈ ${Math.round((count * seconds) / 60)} мин на билет`
      : 'Без ограничения времени';

    const weakRow = document.getElementById('ticketWeakRow');
    const useWeak = weakCheckbox.checked && weak > 0;
    weakRow.hidden = !useWeak;
    document.getElementById('ticketWeak').textContent = useWeak
      ? `${Math.min(weak, count)} ${plural(Math.min(weak, count), 'слабое место', 'слабых места', 'слабых мест')} в начале`
      : '';

    weakHint.textContent = weak
      ? `Найдено: ${weak} — ${weakCheckbox.checked ? 'они будут в начале билета' : 'сейчас выключено'}`
      : 'Пока не отмечено — пройди пару тестов в тренажёре';

    if (bump && ticketEl && !reduced()) {
      ticketEl.classList.remove('is-bump');
      void ticketEl.offsetWidth;
      ticketEl.classList.add('is-bump');
    }
  }

  disciplineSelect.addEventListener('change', () => updateTicket(true));
  weakCheckbox.addEventListener('change', () => updateTicket(true));

  function renderHistory() {
    const el = document.getElementById('examHistory');
    const attempts = typeof LexPrepProgress.getExamAttempts === 'function' ? LexPrepProgress.getExamAttempts() : [];
    if (!attempts.length) {
      el.innerHTML = `<span class="exam-chip">${examIcon('sparkles')}Первый билет — впереди</span>`;
      return;
    }
    const pct = a => (a.total ? Math.round((a.score / a.total) * 100) : 0);
    const best = Math.max(...attempts.map(pct));
    const last = pct(attempts[attempts.length - 1]);
    el.innerHTML = `
      <span class="exam-chip">${examIcon('books')}Билетов: <b>${attempts.length}</b></span>
      <span class="exam-chip">${examIcon('trophy')}Лучший: <b>${best}%</b></span>
      <span class="exam-chip">${examIcon('chart-up')}Последний: <b>${last}%</b></span>`;
  }

  renderHistory();
  updateTicket(false);

  const examSetupError = document.getElementById('examSetupError');

  document.getElementById('startExamBtn').addEventListener('click', () => {
    examSetupError.hidden = true;

    if (typeof LexPrepPlan !== 'undefined' && typeof LexPrepProgress !== 'undefined') {
      const examLimit = LexPrepPlan.getLimits().examAttemptsPerMonth;
      const usedThisMonth = LexPrepProgress.getMonthlyUsage().examAttempts || 0;
      if (usedThisMonth >= examLimit) {
        examSetupError.textContent = examLimit === 0
          ? 'Пробный экзамен доступен с тарифа «Про» — оформи подписку в магазине.'
          : `Лимит пробных экзаменов (${examLimit} в месяц) на тарифе «${LexPrepPlan.TIER_TITLES[LexPrepPlan.getTier()]}» исчерпан — попробуй в следующем месяце или оформи «Максимум».`;
        examSetupError.hidden = false;
        return;
      }
    }

    const count = Number(countSelect.value);
    const weakFirst = weakCheckbox.checked;
    const disciplineFilter = disciplineSelect.value;
    const secondsPerQuestion = Number(timeSelect.value);

    const questions = pickQuestions(count, weakFirst, disciplineFilter);
    if (!questions.length) {
      examSetupError.textContent = 'Не удалось собрать вопросы — попробуй выбрать другую дисциплину.';
      examSetupError.hidden = false;
      return;
    }
    if (typeof LexPrepProgress !== 'undefined') {
      LexPrepProgress.incrementMonthlyUsage('examAttempts');
    }
    startExam(questions, secondsPerQuestion);
  });

  /* ---------------- Running screen ---------------- */
  let examQuestions = [];
  let examAnswers = [];
  let currentIndex = 0;
  let timerInterval = null;
  let secondsLeft = 0;
  let secondsTotal = 0;
  let startedAt = 0;

  const progressEl = document.getElementById('examProgress');
  const progressBar = document.getElementById('examProgressBar');
  const timerWrap = document.getElementById('examTimerWrap');
  const timerEl = document.getElementById('examTimer');
  const timerRing = document.getElementById('examTimerRing');
  const topicLabelEl = document.getElementById('examTopicLabel');
  const navEl = document.getElementById('examNav');
  const questionBox = document.getElementById('examQuestionBox');
  const prevBtn = document.getElementById('examPrevBtn');
  const nextBtn = document.getElementById('examNextBtn');
  const finishBtn = document.getElementById('examFinishBtn');
  const RING_LENGTH = 2 * Math.PI * 19;
  timerRing.style.strokeDasharray = String(RING_LENGTH);

  function startExam(questions, secondsPerQuestion) {
    examQuestions = questions;
    examAnswers = new Array(questions.length).fill(null);
    currentIndex = 0;
    startedAt = Date.now();
    navEl.innerHTML = questions.map((_, i) => `<button type="button" class="exam-nav__dot" data-go="${i}" aria-label="Вопрос ${i + 1}">${i + 1}</button>`).join('');
    showView('running');
    renderQuestion(0);

    clearInterval(timerInterval);
    timerWrap.classList.remove('is-low', 'is-unlimited');
    if (secondsPerQuestion > 0) {
      secondsTotal = secondsPerQuestion * questions.length;
      secondsLeft = secondsTotal;
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
      secondsTotal = 0;
      timerWrap.classList.add('is-unlimited');
      timerEl.textContent = '∞';
      timerRing.style.strokeDashoffset = '0';
    }
  }

  function updateTimerDisplay() {
    timerEl.textContent = formatDuration(Math.max(0, secondsLeft));
    const left = secondsTotal ? Math.max(0, secondsLeft) / secondsTotal : 1;
    timerRing.style.strokeDashoffset = String(RING_LENGTH * (1 - left));
    timerWrap.classList.toggle('is-low', secondsLeft <= 30);
  }

  function answeredCount() {
    return examAnswers.filter(a => a && a.length).length;
  }

  function renderNav() {
    navEl.querySelectorAll('[data-go]').forEach(btn => {
      const i = Number(btn.dataset.go);
      btn.classList.toggle('is-current', i === currentIndex);
      btn.classList.toggle('is-answered', !!(examAnswers[i] && examAnswers[i].length));
      if (i === currentIndex) btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
    });
    const current = navEl.querySelector('.is-current');
    // Держим текущий номер в поле зрения, если навигатор прокручивается.
    if (current && navEl.scrollWidth > navEl.clientWidth) {
      navEl.scrollTo({ left: current.offsetLeft - navEl.clientWidth / 2 + current.offsetWidth / 2, behavior: reduced() ? 'auto' : 'smooth' });
    }
    const answered = answeredCount();
    progressBar.style.transform = `scaleX(${examQuestions.length ? answered / examQuestions.length : 0})`;
  }

  function renderQuestion(direction) {
    const item = examQuestions[currentIndex];
    const isMulti = item.question.correct.length > 1;
    const chosen = examAnswers[currentIndex] || [];
    progressEl.innerHTML = `Вопрос <b>${currentIndex + 1}</b> из ${examQuestions.length}`;
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
        renderNav();
      });
    });

    if (!reduced()) {
      questionBox.classList.remove('is-from-left', 'is-from-right');
      void questionBox.offsetWidth;
      questionBox.classList.add(direction < 0 ? 'is-from-left' : 'is-from-right');
    }

    prevBtn.disabled = currentIndex === 0;
    nextBtn.textContent = currentIndex === examQuestions.length - 1 ? 'Завершить экзамен' : 'Далее →';
    renderNav();
  }

  function goTo(index) {
    if (index < 0 || index >= examQuestions.length || index === currentIndex) return;
    const direction = index > currentIndex ? 1 : -1;
    currentIndex = index;
    renderQuestion(direction);
  }

  navEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-go]');
    if (btn) goTo(Number(btn.dataset.go));
  });

  prevBtn.addEventListener('click', () => goTo(currentIndex - 1));

  nextBtn.addEventListener('click', async () => {
    if (currentIndex < examQuestions.length - 1) {
      goTo(currentIndex + 1);
      return;
    }
    const left = examQuestions.length - answeredCount();
    if (left > 0) {
      const ok = await LexPrepDialog.confirm(`Без ответа ${left} ${plural(left, 'вопрос', 'вопроса', 'вопросов')} — они будут засчитаны как неверные. Завершить экзамен?`);
      if (!ok) {
        const firstEmpty = examAnswers.findIndex(a => !a || !a.length);
        if (firstEmpty >= 0) goTo(firstEmpty);
        return;
      }
    }
    finishExam();
  });

  finishBtn.addEventListener('click', async () => {
    if (await LexPrepDialog.confirm('Завершить экзамен досрочно? Неотвеченные вопросы будут засчитаны как неверные.')) {
      finishExam();
    }
  });

  /* ---------------- Results screen ---------------- */
  let lastWrongQuestions = [];
  const SCORE_RING = 2 * Math.PI * 52;

  function finishExam() {
    clearInterval(timerInterval);

    let score = 0;
    const wrongEntries = [];
    const wrongQuestions = [];
    const breakdown = {}; // topicId -> {title, discipline, correct, total}

    examQuestions.forEach((item, i) => {
      const chosen = examAnswers[i];
      const isCorrect = sameAnswerSet(chosen, item.question.correct);
      if (isCorrect) score++;
      else {
        wrongQuestions.push({ ...item, chosen });
      }
      wrongEntries.push({ topicId: item.topicId, qIndex: item.qIndex, correct: isCorrect });

      if (!breakdown[item.topicId]) {
        breakdown[item.topicId] = { title: item.topicTitle, discipline: item.disciplineTitle, correct: 0, total: 0 };
      }
      breakdown[item.topicId].total++;
      if (isCorrect) breakdown[item.topicId].correct++;
    });

    const total = examQuestions.length;
    const uniqueTopics = Array.from(new Set(examQuestions.map(q => q.topicId)));
    LexPrepProgress.recordExamAttempt(score, total, uniqueTopics, wrongEntries);

    lastWrongQuestions = wrongQuestions;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    showView('results');
    renderResults(score, total, breakdown, wrongQuestions, elapsed);
  }

  function gradeFor(percent) {
    if (percent >= 85) return { label: 'Отлично', icon: 'trophy', tone: 'great', msg: 'Уверенный результат — такой билет на зачёте не страшен. Закрепи карточками и бери следующий.' };
    if (percent >= 70) return { label: 'Хорошо', icon: 'star', tone: 'good', msg: 'Хороший результат — можно закреплять карточками и двигаться дальше.' };
    if (percent >= 50) return { label: 'Неплохо', icon: 'target', tone: 'mid', msg: 'Основа есть. Разбери ошибки ниже и пройди неверные ещё раз — это быстро.' };
    return { label: 'Есть над чем поработать', icon: 'books', tone: 'low', msg: 'Загляни в конспект по темам ниже и повтори слабые вопросы — следующий билет пойдёт легче.' };
  }

  function renderResults(score, total, breakdown, wrongQuestions, elapsed) {
    const percent = Math.round((score / total) * 100);
    const grade = gradeFor(percent);
    const box = document.getElementById('examScoreBox');
    box.className = `exam-score exam-score--${grade.tone}`;

    document.getElementById('examGrade').textContent = grade.label;
    document.getElementById('examScoreTitle').textContent = `${score} из ${total} верно`;
    document.getElementById('examScoreMsg').textContent = grade.msg;
    document.getElementById('examScoreIcon').innerHTML = examIcon(grade.icon);

    const percentEl = document.getElementById('examScorePercent');
    const ring = document.getElementById('examScoreRing');
    ring.style.strokeDasharray = String(SCORE_RING);
    if (reduced() || !motion) {
      percentEl.textContent = percent;
      ring.style.strokeDashoffset = String(SCORE_RING * (1 - percent / 100));
    } else {
      percentEl.textContent = '0';
      ring.style.transition = 'none';
      ring.style.strokeDashoffset = String(SCORE_RING);
      void ring.getBoundingClientRect();
      requestAnimationFrame(() => {
        ring.style.transition = '';
        ring.style.strokeDashoffset = String(SCORE_RING * (1 - percent / 100));
        motion.countTo(percentEl, percent, 1100);
      });
      if (percent >= 85) setTimeout(() => motion.confetti(box.querySelector('.exam-score__ring')), 900);
    }

    const xp = score * 3; // столько опыта даёт recordExamAttempt
    document.getElementById('examStats').innerHTML = `
      <div class="exam-stat exam-stat--ok">${examIcon('check')}<b>${score}</b><span>верно</span></div>
      <div class="exam-stat exam-stat--bad">${examIcon('target')}<b>${total - score}</b><span>${plural(total - score, 'ошибка', 'ошибки', 'ошибок')}</span></div>
      <div class="exam-stat">${examIcon('hourglass')}<b>${formatDuration(elapsed)}</b><span>на билет</span></div>
      <div class="exam-stat exam-stat--xp">${examIcon('sparkles')}<b>+${xp}</b><span>опыта</span></div>`;

    const breakdownEl = document.getElementById('examBreakdown');
    breakdownEl.innerHTML = Object.values(breakdown)
      .sort((a, b) => a.correct / a.total - b.correct / b.total)
      .map(b => {
        const p = Math.round((b.correct / b.total) * 100);
        const tone = b.correct === b.total ? 'good' : p >= 60 ? 'mid' : 'bad';
        return `
        <div class="exam-topic exam-topic--${tone}">
          <div class="exam-topic__head">
            <span class="exam-topic__title">${escapeHtml(b.title)}<small>${escapeHtml(b.discipline || '')}</small></span>
            <span class="exam-topic__score">${b.correct} / ${b.total}</span>
          </div>
          <span class="exam-topic__bar"><span style="--w: ${p}%"></span></span>
        </div>`;
      }).join('');

    document.getElementById('examReviewCount').textContent = wrongQuestions.length ? wrongQuestions.length : '';
    const reviewEl = document.getElementById('examReview');
    if (!wrongQuestions.length) {
      reviewEl.innerHTML = `<div class="exam-review__empty">${examIcon('check')}<span>Все ответы верные — разбирать нечего.</span></div>`;
    } else {
      reviewEl.innerHTML = wrongQuestions.map((item, n) => {
        const chosenText = item.chosen && item.chosen.length
          ? item.chosen.map(i => item.question.options[i]).join('; ')
          : 'не выбран';
        const correctText = item.question.correct.map(i => item.question.options[i]).join('; ');
        return `
        <details class="exam-review__item" ${n === 0 ? 'open' : ''}>
          <summary>
            <span class="exam-review__num">${n + 1}</span>
            <span class="exam-review__q">
              <small>${escapeHtml(item.topicTitle)}</small>
              ${escapeHtml(item.question.question)}
            </span>
            <svg class="exam-review__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="exam-review__body">
            <div class="exam-answer exam-answer--wrong"><span>Твой ответ</span>${escapeHtml(chosenText)}</div>
            <div class="exam-answer exam-answer--right"><span>Правильный ответ</span>${escapeHtml(correctText)}</div>
            ${item.question.explanation ? `<p class="exam-review__why"><b>Почему:</b> ${escapeHtml(item.question.explanation)}</p>` : ''}
          </div>
        </details>`;
      }).join('');
    }

    if (motion) {
      motion.stagger(document.getElementById('examStats'), '.exam-stat', 250);
      motion.stagger(breakdownEl, '.exam-topic', 350);
    }

    const retryBtn = document.getElementById('retryWeakBtn');
    retryBtn.hidden = wrongQuestions.length === 0;
  }

  document.getElementById('retryWeakBtn').addEventListener('click', () => {
    if (!lastWrongQuestions.length) return;
    startExam(lastWrongQuestions.map(({ chosen, ...rest }) => rest), 90);
  });

  document.getElementById('examNewBtn').addEventListener('click', () => {
    document.getElementById('ticketNumber').textContent = 1 + Math.floor(Math.random() * 60);
    renderHistory();
    updateTicket(false);
    showView('setup');
  });

  showView('setup');
}
