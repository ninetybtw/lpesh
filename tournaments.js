/* ==========================================================================
TOURNAMENTS.JS — турнир на выбывание: три раунда против ботов растущей
сложности. Проигрыш раунда — выбывание. Победа в финале — чемпион. Соперники
всегда боты (демо), реальные турниры с участниками появятся с бэкендом.
========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }
  await (window.LexPrepContentReady || Promise.resolve());

  const DATA = LEXPREP_DATA;
  const views = document.querySelectorAll('[data-tourney-view]');

  function showView(name) {
    views.forEach(v => { v.hidden = v.dataset.tourneyView !== name; });
  }

  const TOURNAMENTS = [
    {
      id: 'quick',
      title: 'Быстрый турнир',
      desc: '3 раунда по 5 вопросов из всех тем. Взнос — 30 монет, приз чемпиону — 150 монет.',
      questionsPerRound: 5,
      entryFee: 30,
      prize: 150,
      rounds: ['easy', 'medium', 'hard']
    },
    {
      id: 'weekly',
      title: 'Турнир недели',
      desc: '3 раунда по 10 вопросов из всех тем. Взнос — 60 монет, приз чемпиону — 320 монет.',
      questionsPerRound: 10,
      entryFee: 60,
      prize: 320,
      rounds: ['easy', 'medium', 'hard']
    }
  ];

  const ROUND_LABELS = ['Раунд 1', 'Раунд 2', 'Финал'];

  /* ---------------- List screen ---------------- */
  const listEl = document.getElementById('tourneyList');
  const statsEl = document.getElementById('tourneyStats');

  function renderStats() {
    const duel = LexPrepProgress.getDuelStats();
    const tourney = LexPrepProgress.getTournamentStats();
    statsEl.innerHTML = `
      <div class="duel-stats__item"><span class="duel-stats__num">${tourney.played}</span><span class="duel-stats__label">турниров сыграно</span></div>
      <div class="duel-stats__item"><span class="duel-stats__num">${tourney.champions}</span><span class="duel-stats__label">раз чемпион</span></div>
      <div class="duel-stats__item duel-stats__item--rating"><span class="duel-stats__num">${duel.rating}</span><span class="duel-stats__label">дуэльный рейтинг</span></div>
    `;
  }

  function tournamentAllowance() {
    const limit = LexPrepPlan.getLimits().tourneysPerMonth;
    if (limit === 0) return { allowed: false, label: 'Доступно с тарифа «Про»' };
    if (LexPrepProgress.getMonthlyUsage().tourneysPlayed >= limit) {
      return { allowed: false, label: `Лимит ${limit}/мес исчерпан` };
    }
    return { allowed: true, label: null };
  }

  function renderList() {
    const balance = LexPrepProgress.getCoins();
    const tickets = LexPrepProgress.getInventory().tourneyTickets || 0;
    const allowance = tournamentAllowance();
    listEl.innerHTML = TOURNAMENTS.map(t => {
      const freeEntry = tickets > 0;
      const blocked = !allowance.allowed || (!freeEntry && balance < t.entryFee);
      const label = !allowance.allowed
        ? allowance.label
        : (freeEntry ? 'Участвовать (билет бесплатно)' : (balance < t.entryFee ? 'Не хватает монет' : 'Участвовать'));
      return `
      <div class="tourney-card">
        <div class="tourney-card__title">${DuelEngine.escapeHtml(t.title)}</div>
        <div class="tourney-card__desc">${DuelEngine.escapeHtml(t.desc)}</div>
        <div class="tourney-card__meta">
          <span>Взнос: ${t.entryFee} монет</span>
          <span>Приз: ${t.prize} монет</span>
        </div>
        <button class="btn btn--primary tourney-card__btn" type="button" data-join="${t.id}" ${blocked ? 'disabled' : ''}>
          ${label}
        </button>
      </div>
    `;
    }).join('');

    listEl.querySelectorAll('[data-join]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tourney = TOURNAMENTS.find(t => t.id === btn.dataset.join);
        if (!tourney) return;
        if (!tournamentAllowance().allowed) return;
        // Купленный в магазине билет (LexPrepProgress inventory.tourneyTickets)
        // избавляет от обычного взноса монетами — пробуем сначала его,
        // и только если билетов нет, списываем монеты.
        const usedTicket = LexPrepProgress.spendInventory('tourneyTickets');
        if (!usedTicket && !LexPrepProgress.spendCoins(tourney.entryFee)) return;
        if (typeof initCoinBadge === 'function') initCoinBadge();
        LexPrepProgress.incrementMonthlyUsage('tourneysPlayed');
        startTournament(tourney);
      });
    });
  }

  renderStats();
  renderList();

  /* ---------------- Bracket / battle screen ---------------- */
  let activeTourney = null;
  let roundIndex = 0;
  let roundStatus = []; // 'pending' | 'current' | 'win' | 'loss'
  let botNames = [];
  let duelQuestions = [];
  let currentIndex = 0;
  let playerScore = 0;
  let botScore = 0;
  let answered = false;
  let chosen = [];

  const bracketEl = document.getElementById('tourneyBracket');
  const resultBracketEl = document.getElementById('tourneyResultBracket');
  const playerAvatarEl = document.getElementById('tourneyPlayerAvatar');
  const playerNameEl = document.getElementById('tourneyPlayerName');
  const playerScoreEl = document.getElementById('tourneyPlayerScore');
  const botNameEl = document.getElementById('tourneyBotName');
  const botScoreEl = document.getElementById('tourneyBotScore');
  const progressEl = document.getElementById('tourneyProgress');
  const topicLabelEl = document.getElementById('tourneyTopicLabel');
  const questionBox = document.getElementById('tourneyQuestionBox');
  const roundResultEl = document.getElementById('tourneyRoundResult');
  const answerBtn = document.getElementById('tourneyAnswerBtn');

  function renderBracket(target) {
    target.innerHTML = `
      <div class="tourney-bracket__title">${DuelEngine.escapeHtml(activeTourney.title)}</div>
      <div class="tourney-bracket__rounds">
        ${ROUND_LABELS.map((label, i) => `
          <div class="tourney-round tourney-round--${roundStatus[i]}">
            <span class="tourney-round__dot"></span>
            <span class="tourney-round__label">${label}</span>
            <span class="tourney-round__bot">${DuelEngine.escapeHtml(botNames[i] || '')}</span>
          </div>
        `).join('<span class="tourney-round__arrow">→</span>')}
      </div>
    `;
  }

  function startTournament(tourney) {
    activeTourney = tourney;
    roundIndex = 0;
    roundStatus = ['current', 'pending', 'pending'];
    botNames = tourney.rounds.map(() => DuelEngine.pickBotName());

    playerNameEl.textContent = (user.name || 'Ты').trim();
    if (user.avatar) {
      playerAvatarEl.textContent = '';
      playerAvatarEl.style.backgroundImage = `url(${user.avatar})`;
    } else {
      playerAvatarEl.textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
      playerAvatarEl.style.backgroundImage = '';
    }

    showView('battle');
    startRound();
  }

  function startRound() {
    const difficulty = activeTourney.rounds[roundIndex];
    duelQuestions = DuelEngine.pickQuestions(DATA, activeTourney.questionsPerRound, 'all', 'all');
    currentIndex = 0;
    playerScore = 0;
    botScore = 0;

    botNameEl.textContent = `${botNames[roundIndex]} (${DuelEngine.DIFFICULTIES[difficulty].label.toLowerCase()})`;
    renderBracket(bracketEl);
    renderQuestion();
  }

  function renderQuestion() {
    answered = false;
    chosen = [];
    roundResultEl.hidden = true;
    answerBtn.textContent = 'Ответить';
    answerBtn.disabled = true;

    const item = duelQuestions[currentIndex];
    const isMulti = item.question.correct.length > 1;
    progressEl.textContent = `${ROUND_LABELS[roundIndex]} — вопрос ${currentIndex + 1} из ${duelQuestions.length}`;
    topicLabelEl.textContent = `${item.disciplineTitle} → ${item.topicTitle}`;
    playerScoreEl.textContent = playerScore;
    botScoreEl.textContent = botScore;

    questionBox.innerHTML = `
      <h4>${DuelEngine.escapeHtml(item.question.question)}</h4>
      ${isMulti ? '<p class="question--multi__hint">Выбери все подходящие варианты</p>' : ''}
      <div class="answers">
        ${item.question.options.map((option, i) => `
          <label class="answer">
            <input type="${isMulti ? 'checkbox' : 'radio'}" name="tourney-answer" value="${i}">
            <span>${DuelEngine.escapeHtml(option)}</span>
          </label>
        `).join('')}
      </div>
    `;

    questionBox.querySelectorAll('input[name="tourney-answer"]').forEach(input => {
      input.addEventListener('change', () => {
        chosen = Array.from(questionBox.querySelectorAll('input[name="tourney-answer"]:checked')).map(el => Number(el.value));
        answerBtn.disabled = chosen.length === 0;
      });
    });
  }

  answerBtn.addEventListener('click', () => {
    const difficulty = activeTourney.rounds[roundIndex];

    if (!answered) {
      answered = true;
      const item = duelQuestions[currentIndex];
      const playerCorrect = DuelEngine.sameAnswerSet(chosen, item.question.correct);
      const botCorrect = DuelEngine.botAnswerCorrect(difficulty);
      if (playerCorrect) playerScore++;
      if (botCorrect) botScore++;

      playerScoreEl.textContent = playerScore;
      botScoreEl.textContent = botScore;
      questionBox.querySelectorAll('input[name="tourney-answer"]').forEach(input => { input.disabled = true; });

      roundResultEl.hidden = false;
      roundResultEl.innerHTML = `
        <span class="${playerCorrect ? 'duel-round-result__ok' : 'duel-round-result__bad'}">Ты: ${playerCorrect ? 'верно' : 'неверно'}</span>
        <span class="${botCorrect ? 'duel-round-result__ok' : 'duel-round-result__bad'}">${DuelEngine.escapeHtml(botNames[roundIndex])}: ${botCorrect ? 'верно' : 'неверно'}</span>
        <p class="duel-round-result__explain">${DuelEngine.escapeHtml(item.question.explanation)}</p>
      `;

      answerBtn.textContent = currentIndex === duelQuestions.length - 1 ? 'Итог раунда' : 'Следующий вопрос →';
      return;
    }

    if (currentIndex < duelQuestions.length - 1) {
      currentIndex++;
      renderQuestion();
    } else {
      finishRound();
    }
  });

  function finishRound() {
    const won = playerScore > botScore;
    LexPrepProgress.recordDuelResult(won ? 'win' : (playerScore === botScore ? 'draw' : 'loss'));
    roundStatus[roundIndex] = won ? 'win' : 'loss';

    if (!won) {
      finishTournament(false);
      return;
    }

    if (roundIndex === activeTourney.rounds.length - 1) {
      finishTournament(true);
      return;
    }

    roundIndex++;
    roundStatus[roundIndex] = 'current';
    startRound();
  }

  /* ---------------- Results screen ---------------- */
  function finishTournament(isChampion) {
    const tourneyStats = LexPrepProgress.recordTournamentResult(isChampion);
    renderBracket(resultBracketEl);

    const titleEl = document.getElementById('tourneyResultTitle');
    const msgEl = document.getElementById('tourneyResultMsg');

    if (isChampion) {
      LexPrepProgress.addCoins(activeTourney.prize);
      titleEl.textContent = `Чемпион турнира «${activeTourney.title}»!`;
      msgEl.textContent = `Все три раунда пройдены. Приз: +${activeTourney.prize} монет. Всего турниров с титулом чемпиона: ${tourneyStats.champions}.`;
    } else {
      titleEl.textContent = `Выбывание — ${ROUND_LABELS[roundIndex]}`;
      msgEl.textContent = `Раунд проигран, взнос ${activeTourney.entryFee} монет не возвращается. Дуэльный рейтинг обновлён за пройденные раунды.`;
    }

    showView('results');
    renderStats();
    renderList();
    if (typeof initCoinBadge === 'function') initCoinBadge();
  }

  document.getElementById('tourneyBackBtn').addEventListener('click', () => {
    renderStats();
    renderList();
    showView('list');
  });

  showView('list');
});
