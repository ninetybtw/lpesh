/* ==========================================================================
DUEL.JS — дуэль 1 на 1 против бота: выбор тем/количества вопросов/ставки,
раунд за раундом сравнение ответов игрока и бота, начисление монет и
дуэльного рейтинга по итогу. Соперник — бот (демо), не реальный игрок.
========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }

  const DATA = LEXPREP_DATA;
  const views = document.querySelectorAll('[data-duel-view]');

  function showView(name) {
    views.forEach(v => { v.hidden = v.dataset.duelView !== name; });
  }

  const WAGER_PRESETS = [10, 25, 50, 100];

  /* ---------------- Setup screen ---------------- */
  const disciplineSelect = document.getElementById('duelDiscipline');
  const topicSelect = document.getElementById('duelTopic');
  const wagerInput = document.getElementById('duelWager');
  const balanceEl = document.getElementById('duelBalance');
  const errorEl = document.getElementById('duelSetupError');
  const statsEl = document.getElementById('duelStats');

  disciplineSelect.innerHTML = `<option value="all">Все дисциплины</option>` +
    DATA.map(d => `<option value="${d.id}">${DuelEngine.escapeHtml(d.title)}</option>`).join('');

  function renderTopicOptions() {
    const discId = disciplineSelect.value;
    if (discId === 'all') {
      topicSelect.innerHTML = `<option value="all">Все темы</option>`;
      topicSelect.disabled = true;
      return;
    }
    const discipline = DATA.find(d => d.id === discId);
    topicSelect.disabled = false;
    topicSelect.innerHTML = `<option value="all">Все темы дисциплины</option>` +
      (discipline ? discipline.topics.map(t => `<option value="${t.id}">${DuelEngine.escapeHtml(t.title)}</option>`).join('') : '');
  }

  disciplineSelect.addEventListener('change', renderTopicOptions);
  renderTopicOptions();

  function renderStats() {
    const stats = LexPrepProgress.getDuelStats();
    statsEl.innerHTML = `
      <div class="duel-stats__item"><span class="duel-stats__num">${stats.wins}</span><span class="duel-stats__label">побед</span></div>
      <div class="duel-stats__item"><span class="duel-stats__num">${stats.losses}</span><span class="duel-stats__label">поражений</span></div>
      <div class="duel-stats__item"><span class="duel-stats__num">${stats.draws}</span><span class="duel-stats__label">ничьих</span></div>
      <div class="duel-stats__item duel-stats__item--rating"><span class="duel-stats__num">${stats.rating}</span><span class="duel-stats__label">рейтинг</span></div>
    `;
  }

  function renderBalance() {
    balanceEl.textContent = LexPrepProgress.getCoins();
    if (typeof initCoinBadge === 'function') initCoinBadge();
  }

  const presetsEl = document.getElementById('duelWagerPresets');
  presetsEl.innerHTML = WAGER_PRESETS.map(v => `<button type="button" class="duel-preset-btn" data-wager="${v}">${v}</button>`).join('');
  presetsEl.querySelectorAll('[data-wager]').forEach(btn => {
    btn.addEventListener('click', () => { wagerInput.value = btn.dataset.wager; });
  });

  renderStats();
  renderBalance();

  document.getElementById('startDuelBtn').addEventListener('click', () => {
    errorEl.hidden = true;

    const count = Number(document.getElementById('duelCount').value);
    const difficulty = document.getElementById('duelDifficulty').value;
    const disciplineId = disciplineSelect.value;
    const topicId = topicSelect.value;
    const wager = Math.floor(Number(wagerInput.value));

    const balance = LexPrepProgress.getCoins();
    if (!wager || wager < 1) {
      errorEl.textContent = 'Укажи ставку от 1 монеты.';
      errorEl.hidden = false;
      return;
    }
    if (wager > balance) {
      errorEl.textContent = `Не хватает монет: на балансе ${balance}, а ставка ${wager}.`;
      errorEl.hidden = false;
      return;
    }

    const questions = DuelEngine.pickQuestions(DATA, count, disciplineId, topicId);
    if (questions.length < count) {
      errorEl.textContent = 'В выбранной теме недостаточно вопросов — выбери другую тему или дисциплину «Все».';
      errorEl.hidden = false;
      return;
    }

    if (!LexPrepProgress.spendCoins(wager)) {
      errorEl.textContent = 'Не удалось списать ставку — попробуй ещё раз.';
      errorEl.hidden = false;
      return;
    }
    if (typeof initCoinBadge === 'function') initCoinBadge();

    startDuel(questions, wager, difficulty);
  });

  /* ---------------- Battle screen ---------------- */
  let duelQuestions = [];
  let duelWager = 0;
  let duelDifficulty = 'medium';
  let botName = 'Бот';
  let currentIndex = 0;
  let playerScore = 0;
  let botScore = 0;
  let answered = false;
  let chosen = null;
  const roundLog = [];

  const playerAvatarEl = document.getElementById('duelPlayerAvatar');
  const playerNameEl = document.getElementById('duelPlayerName');
  const playerScoreEl = document.getElementById('duelPlayerScore');
  const botNameEl = document.getElementById('duelBotName');
  const botScoreEl = document.getElementById('duelBotScore');
  const progressEl = document.getElementById('duelProgress');
  const topicLabelEl = document.getElementById('duelTopicLabel');
  const questionBox = document.getElementById('duelQuestionBox');
  const roundResultEl = document.getElementById('duelRoundResult');
  const answerBtn = document.getElementById('duelAnswerBtn');

  function startDuel(questions, wager, difficulty) {
    duelQuestions = questions;
    duelWager = wager;
    duelDifficulty = difficulty;
    botName = DuelEngine.pickBotName();
    currentIndex = 0;
    playerScore = 0;
    botScore = 0;
    roundLog.length = 0;

    playerNameEl.textContent = (user.name || 'Ты').trim();
    if (user.avatar) {
      playerAvatarEl.textContent = '';
      playerAvatarEl.style.backgroundImage = `url(${user.avatar})`;
    } else {
      playerAvatarEl.textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
      playerAvatarEl.style.backgroundImage = '';
    }
    botNameEl.textContent = `${botName} (${DuelEngine.DIFFICULTIES[difficulty].label.toLowerCase()})`;

    showView('battle');
    renderQuestion();
  }

  function renderQuestion() {
    answered = false;
    chosen = null;
    roundResultEl.hidden = true;
    answerBtn.textContent = 'Ответить';
    answerBtn.disabled = true;

    const item = duelQuestions[currentIndex];
    progressEl.textContent = `Вопрос ${currentIndex + 1} из ${duelQuestions.length}`;
    topicLabelEl.textContent = `${item.disciplineTitle} → ${item.topicTitle}`;
    playerScoreEl.textContent = playerScore;
    botScoreEl.textContent = botScore;

    questionBox.innerHTML = `
      <h4>${DuelEngine.escapeHtml(item.question.question)}</h4>
      <div class="answers">
        ${item.question.options.map((option, i) => `
          <label class="answer">
            <input type="radio" name="duel-answer" value="${i}">
            <span>${DuelEngine.escapeHtml(option)}</span>
          </label>
        `).join('')}
      </div>
    `;

    questionBox.querySelectorAll('input[name="duel-answer"]').forEach(input => {
      input.addEventListener('change', () => {
        chosen = Number(input.value);
        answerBtn.disabled = false;
      });
    });
  }

  answerBtn.addEventListener('click', () => {
    if (!answered) {
      answered = true;
      const item = duelQuestions[currentIndex];
      const playerCorrect = chosen === item.question.correct;
      const botCorrect = DuelEngine.botAnswerCorrect(duelDifficulty);
      if (playerCorrect) playerScore++;
      if (botCorrect) botScore++;

      roundLog.push({ item, chosen, playerCorrect, botCorrect });
      playerScoreEl.textContent = playerScore;
      botScoreEl.textContent = botScore;

      questionBox.querySelectorAll('input[name="duel-answer"]').forEach(input => { input.disabled = true; });

      roundResultEl.hidden = false;
      roundResultEl.innerHTML = `
        <span class="${playerCorrect ? 'duel-round-result__ok' : 'duel-round-result__bad'}">Ты: ${playerCorrect ? 'верно' : 'неверно'}</span>
        <span class="${botCorrect ? 'duel-round-result__ok' : 'duel-round-result__bad'}">${DuelEngine.escapeHtml(botName)}: ${botCorrect ? 'верно' : 'неверно'}</span>
        <p class="duel-round-result__explain">${DuelEngine.escapeHtml(item.question.explanation)}</p>
      `;

      answerBtn.textContent = currentIndex === duelQuestions.length - 1 ? 'Завершить дуэль' : 'Следующий вопрос →';
      return;
    }

    if (currentIndex < duelQuestions.length - 1) {
      currentIndex++;
      renderQuestion();
    } else {
      finishDuel();
    }
  });

  /* ---------------- Results screen ---------------- */
  function finishDuel() {
    let outcome;
    if (playerScore > botScore) outcome = 'win';
    else if (playerScore < botScore) outcome = 'loss';
    else outcome = 'draw';

    if (outcome === 'win') LexPrepProgress.addCoins(duelWager * 2);
    else if (outcome === 'draw') LexPrepProgress.addCoins(duelWager);

    const stats = LexPrepProgress.recordDuelResult(outcome);

    const titleEl = document.getElementById('duelResultTitle');
    const msgEl = document.getElementById('duelResultMsg');
    if (outcome === 'win') {
      titleEl.textContent = `Победа! ${playerScore} : ${botScore}`;
      msgEl.textContent = `Ставка отыграна: +${duelWager} монет. Дуэльный рейтинг: ${stats.rating} (+18).`;
    } else if (outcome === 'loss') {
      titleEl.textContent = `Поражение: ${playerScore} : ${botScore}`;
      msgEl.textContent = `Ставка потеряна: −${duelWager} монет. Дуэльный рейтинг: ${stats.rating} (−12).`;
    } else {
      titleEl.textContent = `Ничья: ${playerScore} : ${botScore}`;
      msgEl.textContent = `Ставка возвращена. Дуэльный рейтинг: ${stats.rating} (+2).`;
    }

    const breakdownEl = document.getElementById('duelBreakdown');
    breakdownEl.innerHTML = roundLog.map((r, i) => `
      <div class="results-row">
        <span class="results-row__topic">${i + 1}. ${DuelEngine.escapeHtml(r.item.topicTitle)}</span>
        <span class="results-row__score ${r.playerCorrect ? 'results-row__score--good' : 'results-row__score--bad'}">Ты: ${r.playerCorrect ? '✓' : '✗'}</span>
        <span class="results-row__score ${r.botCorrect ? 'results-row__score--good' : 'results-row__score--bad'}">${DuelEngine.escapeHtml(botName)}: ${r.botCorrect ? '✓' : '✗'}</span>
      </div>
    `).join('');

    showView('results');
    renderStats();
    renderBalance();
  }

  document.getElementById('duelPlayAgainBtn').addEventListener('click', () => {
    renderBalance();
    renderStats();
    errorEl.hidden = true;
    showView('setup');
  });

  showView('setup');
});
