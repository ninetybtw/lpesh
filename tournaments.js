/* ==========================================================================
TOURNAMENTS.JS — турнир на выбывание против РЕАЛЬНЫХ соперников.
Бэкенд: public.tournaments/tournament_participants/tournament_matches (см.
supabase/tournaments.sql). Игрок вступает в лобби одного из двух фиксированных
типов ('quick'/'weekly'); как только лобби набирает нужное число участников,
сервер сам перемешивает их и формирует пары первого раунда. Каждый матч —
синхронный старт с общим таймером на вопрос, тот же приём, что и в дуэлях
(duel-pvp.js): started_at фиксируется один раз, когда оба игрока матча готовы,
и оба клиента независимо считают текущий вопрос от этой метки времени.
========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user || typeof LexPrepApi === 'undefined') return;
  await (window.LexPrepContentReady || Promise.resolve());

  const DATA = LEXPREP_DATA;
  const views = document.querySelectorAll('[data-tourney-view]');
  function showView(name) {
    views.forEach(v => { v.hidden = v.dataset.tourneyView !== name; });
  }

  const TOURNAMENT_TYPES = [
    { id: 'quick', title: 'Быстрый турнир', desc: '4 игрока, сетка на выбывание, 5 вопросов на матч. Приз чемпиону — 150 монет.' },
    { id: 'weekly', title: 'Турнир недели', desc: '8 игроков, сетка на выбывание, 10 вопросов на матч. Приз чемпиону — 320 монет.' }
  ];

  function escapeHtml(str) { return DuelEngine.escapeHtml(str); }

  /* ---------------- List screen ---------------- */
  const listEl = document.getElementById('tourneyList');

  function tournamentAllowance() {
    const limit = LexPrepPlan.getLimits().tourneysPerMonth;
    if (limit === 0) return { allowed: false, label: 'Доступно с тарифа «Про»' };
    if (LexPrepProgress.getMonthlyUsage().tourneysPlayed >= limit) {
      const tickets = LexPrepProgress.getInventory().tourneyTickets || 0;
      if (tickets > 0) return { allowed: true, label: null, usesTicket: true };
      return { allowed: false, label: `Лимит ${limit}/мес исчерпан` };
    }
    return { allowed: true, label: null };
  }

  async function renderList() {
    listEl.innerHTML = TOURNAMENT_TYPES.map(t => `
      <div class="tourney-card" data-tourney-card="${t.id}">
        <div class="tourney-card__title">${escapeHtml(t.title)}</div>
        <div class="tourney-card__desc">${escapeHtml(t.desc)}</div>
        <button class="btn btn--primary tourney-card__btn" type="button" disabled>Загрузка…</button>
      </div>
    `).join('');

    for (const t of TOURNAMENT_TYPES) {
      const card = listEl.querySelector(`[data-tourney-card="${t.id}"]`);
      const btn = card.querySelector('button');
      let state = null;
      try {
        state = await LexPrepApi.getMyTournamentState(t.id);
      } catch (e) { /* гость/ошибка сети — считаем, что не участвует */ }

      if (state && state.tournament.status !== 'completed') {
        btn.disabled = false;
        btn.textContent = 'Продолжить';
        btn.addEventListener('click', () => enterTournamentFlow(t.id));
        continue;
      }

      const allowance = tournamentAllowance();
      btn.disabled = !allowance.allowed;
      btn.textContent = !allowance.allowed
        ? allowance.label
        : (allowance.usesTicket ? 'Участвовать (билет сверх лимита)' : 'Участвовать');
      btn.addEventListener('click', async () => {
        const current = tournamentAllowance();
        if (!current.allowed) return;
        btn.disabled = true;
        try {
          if (current.usesTicket) LexPrepProgress.spendInventory('tourneyTickets');
          LexPrepProgress.incrementMonthlyUsage('tourneysPlayed');
          await LexPrepApi.joinTournament(t.id);
          enterTournamentFlow(t.id);
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    }
  }

  renderList();

  /* ---------------- Waiting screen (лобби / готовность / между раундами) ---------------- */
  const waitingTitleEl = document.getElementById('tourneyWaitingTitle');
  const waitingMsgEl = document.getElementById('tourneyWaitingMsg');
  const readyBtn = document.getElementById('tourneyReadyBtn');

  let pollTimer = null;
  let battleTickTimer = null;
  let currentTypeId = null;
  let currentMatch = null;
  let battleQuestions = [];
  let battleScore = 0;
  let battleFinished = false;
  let renderedIndex = -1;
  let lockedIndex = -1;
  let battleChosen = [];

  function stopTimers() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (battleTickTimer) { clearInterval(battleTickTimer); battleTickTimer = null; }
  }

  async function enterTournamentFlow(typeId) {
    currentTypeId = typeId;
    stopTimers();
    await refreshTournamentFlow();
    pollTimer = setInterval(refreshTournamentFlow, 2000);
  }

  async function refreshTournamentFlow() {
    let state;
    try {
      state = await LexPrepApi.getMyTournamentState(currentTypeId);
    } catch (e) { return; }

    if (!state) {
      stopTimers();
      showView('list');
      renderList();
      return;
    }

    const { tournament, eliminatedRound, match, lobbyCount } = state;

    if (tournament.status === 'completed') {
      stopTimers();
      showFinalResult(tournament, eliminatedRound);
      return;
    }

    if (eliminatedRound) {
      stopTimers();
      showView('results');
      document.getElementById('tourneyResultTitle').textContent = `Выбывание — раунд ${eliminatedRound}`;
      document.getElementById('tourneyResultMsg').textContent = 'В этом матче победил соперник. Спасибо за игру!';
      return;
    }

    if (tournament.status === 'open') {
      showView('waiting');
      readyBtn.hidden = true;
      waitingTitleEl.textContent = 'Собираем участников…';
      waitingMsgEl.textContent = `В лобби ${lobbyCount} из ${tournament.size} игроков — турнир начнётся автоматически, как только наберётся нужное число участников.`;
      return;
    }

    // status === 'active'
    if (!match) {
      showView('waiting');
      readyBtn.hidden = true;
      waitingTitleEl.textContent = `Раунд ${tournament.currentRound}`;
      waitingMsgEl.textContent = 'Ждём формирования следующего матча…';
      return;
    }

    currentMatch = match;

    if (match.status === 'pending') {
      stopTimers();
      pollTimer = setInterval(refreshTournamentFlow, 1500);
      showView('waiting');
      const iAmP1 = match.player1Id === user.id;
      const iAmReady = iAmP1 ? match.player1Ready : match.player2Ready;
      const oppReady = iAmP1 ? match.player2Ready : match.player1Ready;
      waitingTitleEl.textContent = `Раунд ${tournament.currentRound} — твой матч`;
      waitingMsgEl.textContent = oppReady
        ? 'Соперник готов — начинайте, как только нажмёшь «Готов».'
        : (iAmReady ? 'Ты готов, ждём соперника…' : 'Нажми «Готов», когда будешь готов начать одновременно с соперником.');
      readyBtn.hidden = false;
      readyBtn.disabled = iAmReady;
      readyBtn.textContent = iAmReady ? 'Ты готов' : 'Готов';
      readyBtn.onclick = async () => {
        readyBtn.disabled = true;
        try {
          const updated = await LexPrepApi.markTournamentMatchReady(match.id);
          currentMatch = updated;
          if (updated.startedAt) {
            stopTimers();
            beginBattle(tournament, updated);
          }
        } catch (err) {
          alert(err.message);
          readyBtn.disabled = false;
        }
      };
      return;
    }

    if (match.status === 'active' && !battleTickTimer) {
      stopTimers();
      beginBattle(tournament, match);
    }
  }

  /* ---------------- Battle (общий таймер на вопрос) ---------------- */
  const progressEl = document.getElementById('tourneyProgress');
  const topicLabelEl = document.getElementById('tourneyTopicLabel');
  const questionBox = document.getElementById('tourneyQuestionBox');
  const roundResultEl = document.getElementById('tourneyRoundResult');
  const answerBtn = document.getElementById('tourneyAnswerBtn');
  const playerAvatarEl = document.getElementById('tourneyPlayerAvatar');
  const playerNameEl = document.getElementById('tourneyPlayerName');
  const playerScoreEl = document.getElementById('tourneyPlayerScore');
  const opponentNameEl = document.getElementById('tourneyOpponentName');
  const opponentScoreEl = document.getElementById('tourneyOpponentScore');

  function beginBattle(tournament, match) {
    battleQuestions = DuelEngine.resolveQuestions(DATA, match.questionIds);
    battleScore = 0;
    battleFinished = false;
    renderedIndex = -1;
    lockedIndex = -1;

    playerNameEl.textContent = (user.name || 'Ты').trim();
    playerAvatarEl.textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
    if (user.avatar) playerAvatarEl.style.backgroundImage = `url(${user.avatar})`;
    opponentNameEl.textContent = 'Соперник';
    opponentScoreEl.textContent = '?';
    playerScoreEl.textContent = '0';

    showView('battle');

    const startedAtMs = new Date(match.startedAt).getTime();
    const durationMs = tournament.secondsPerQuestion * 1000;

    function tick() {
      const elapsed = Date.now() - startedAtMs;
      const index = Math.floor(elapsed / durationMs);

      if (index >= battleQuestions.length) {
        finishBattle(match);
        return;
      }

      if (index !== renderedIndex) renderQuestion(index);

      const remainingSec = Math.max(0, Math.ceil((durationMs - (elapsed % durationMs)) / 1000));
      progressEl.textContent = `Вопрос ${index + 1} из ${battleQuestions.length} · осталось ${remainingSec}с`;
    }

    tick();
    battleTickTimer = setInterval(tick, 250);
  }

  function renderQuestion(index) {
    renderedIndex = index;
    battleChosen = [];
    roundResultEl.hidden = true;
    answerBtn.textContent = 'Ответить';
    answerBtn.disabled = true;

    const item = battleQuestions[index];
    const isMulti = item.question.correct.length > 1;
    topicLabelEl.textContent = `${item.disciplineTitle} → ${item.topicTitle}`;

    questionBox.innerHTML = `
      <h4>${escapeHtml(item.question.question)}</h4>
      ${isMulti ? '<p class="question--multi__hint">Выбери все подходящие варианты</p>' : ''}
      <div class="answers">
        ${item.question.options.map((option, i) => `
          <label class="answer">
            <input type="${isMulti ? 'checkbox' : 'radio'}" name="tourney-answer" value="${i}">
            <span>${escapeHtml(option)}</span>
          </label>
        `).join('')}
      </div>
    `;

    questionBox.querySelectorAll('input[name="tourney-answer"]').forEach(input => {
      input.addEventListener('change', () => {
        battleChosen = Array.from(questionBox.querySelectorAll('input[name="tourney-answer"]:checked')).map(el => Number(el.value));
        answerBtn.disabled = battleChosen.length === 0;
      });
    });
  }

  function lockCurrentAnswer(index) {
    if (lockedIndex === index) return;
    lockedIndex = index;
    const item = battleQuestions[index];
    const correct = DuelEngine.sameAnswerSet(battleChosen, item.question.correct);
    if (correct) battleScore++;
    playerScoreEl.textContent = String(battleScore);

    questionBox.querySelectorAll('input[name="tourney-answer"]').forEach(input => { input.disabled = true; });
    answerBtn.disabled = true;

    roundResultEl.hidden = false;
    roundResultEl.innerHTML = `
      <span class="${correct ? 'duel-round-result__ok' : 'duel-round-result__bad'}">${battleChosen.length ? (correct ? 'Верно' : 'Неверно') : 'Время вышло'}</span>
      <p class="duel-round-result__explain">${escapeHtml(item.question.explanation)}</p>
    `;
  }

  answerBtn.addEventListener('click', () => lockCurrentAnswer(renderedIndex));

  async function finishBattle(match) {
    if (battleFinished) return;
    battleFinished = true;
    stopTimers();
    showView('waiting');
    waitingTitleEl.textContent = 'Матч завершён';
    waitingMsgEl.textContent = 'Отправляем результат…';
    readyBtn.hidden = true;

    try {
      await LexPrepApi.submitTournamentScore(match.id, battleScore);
    } catch (err) {
      alert(err.message);
    }
    pollTimer = setInterval(refreshTournamentFlow, 1500);
    refreshTournamentFlow();
  }

  /* ---------------- Final results ---------------- */
  function showFinalResult(tournament, eliminatedRound) {
    showView('results');
    const titleEl = document.getElementById('tourneyResultTitle');
    const msgEl = document.getElementById('tourneyResultMsg');
    const isChampion = tournament.winnerId === user.id;

    if (isChampion) {
      titleEl.textContent = 'Чемпион турнира!';
      msgEl.textContent = `Вся сетка пройдена. Приз: +${tournament.prizeCoins} монет уже начислены на баланс.`;
      LexPrepApi.me().then(fresh => {
        localStorage.setItem('lexprep_user', JSON.stringify(fresh));
        if (typeof initCoinBadge === 'function') initCoinBadge();
      }).catch(() => {});
    } else {
      titleEl.textContent = `Турнир завершён — выбывание в раунде ${eliminatedRound || '?'}`;
      msgEl.textContent = 'В этот раз не получилось дойти до финала — попробуй в следующем турнире.';
    }
  }

  document.getElementById('tourneyBackBtn').addEventListener('click', () => {
    stopTimers();
    showView('list');
    renderList();
  });
  document.getElementById('tourneyWaitingBackBtn').addEventListener('click', () => {
    stopTimers();
    showView('list');
    renderList();
  });

  showView('list');
});
