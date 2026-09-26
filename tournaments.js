/* ==========================================================================
TOURNAMENTS.JS — турнир на выбывание против РЕАЛЬНЫХ соперников.
Бэкенд: public.tournaments/tournament_participants/tournament_matches (см.
supabase/tournaments.sql). Игрок вступает в лобби одного из двух фиксированных
типов ('quick'/'weekly'); как только лобби набирает нужное число участников,
сервер сам перемешивает их и формирует пары первого раунда. Каждый матч —
синхронный старт с общим таймером на вопрос, тот же приём, что и в дуэлях
(duel-pvp.js): started_at фиксируется один раз, когда оба игрока матча готовы,
и оба клиента независимо считают текущий вопрос от этой метки времени.
Отображение «как в игре» (лобби со слотами, VS, табло, сетка) — arena.js.
========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user || typeof LexPrepApi === 'undefined') return;
  await (window.LexPrepContentReady || Promise.resolve());

  const DATA = LEXPREP_DATA;
  const views = document.querySelectorAll('[data-tourney-view]');
  let currentView = null;
  function showView(name) {
    views.forEach(v => { v.hidden = v.dataset.tourneyView !== name; });
    document.body.classList.toggle('arena-in-game', name === 'battle' || name === 'results');
    if (name !== currentView) {
      Arena.animateIn(document.querySelector(`[data-tourney-view="${name}"]`), 'arena-enter');
      window.scrollTo({ top: 0, behavior: Arena.reduced() ? 'auto' : 'smooth' });
    }
    currentView = name;
  }

  const TOURNAMENT_TYPES = [
    { id: 'quick', emoji: '⚡', title: 'Быстрый турнир', desc: 'Короткая сетка на вечер — четыре игрока, два раунда.', size: 4, questions: 5, prize: 150 },
    { id: 'weekly', emoji: '🏆', title: 'Турнир недели', desc: 'Большая сетка — восемь игроков, три раунда до чемпиона.', size: 8, questions: 10, prize: 320 }
  ];

  const esc = Arena.esc;

  // Название раунда по тому, сколько раундов осталось до конца сетки.
  function roundName(round, size) {
    const total = Math.round(Math.log2(size || 2));
    const left = total - round + 1;
    if (left === 1) return 'Финал';
    if (left === 2) return 'Полуфинал';
    if (left === 3) return 'Четвертьфинал';
    return `Раунд ${round}`;
  }

  // Карточки игроков по id — кэш на всю страницу.
  const profileCache = new Map();
  async function ensureProfiles(ids) {
    const missing = Array.from(new Set(ids.filter(id => id && !profileCache.has(id))));
    if (!missing.length) return;
    const loaded = await Arena.loadProfiles(missing);
    missing.forEach(id => profileCache.set(id, loaded.get(id) || null));
  }
  function playerFor(id, fallback) {
    if (id === user.id) return Arena.me(user);
    return Arena.fromProfile(profileCache.get(id), fallback || 'Соперник');
  }
  function shortName(id) {
    if (id === user.id) return 'Ты';
    const p = profileCache.get(id);
    return (p && p.name) || 'Игрок';
  }

  /* ---------------- Список турниров ---------------- */
  const listEl = document.getElementById('tourneyList');
  const cardState = {};

  function tournamentAllowance() {
    if (user.isAdmin || user.isModerator) return { allowed: true, label: null };
    const limit = LexPrepPlan.getLimits().tourneysPerMonth;
    if (limit === 0) return { allowed: false, label: 'Доступно с тарифа «Про»' };
    if (LexPrepProgress.getMonthlyUsage().tourneysPlayed >= limit) {
      const tickets = LexPrepProgress.getInventory().tourneyTickets || 0;
      if (tickets > 0) return { allowed: true, label: null, usesTicket: true };
      return { allowed: false, label: `Лимит ${limit}/мес исчерпан` };
    }
    return { allowed: true, label: null };
  }

  function buildList() {
    listEl.innerHTML = TOURNAMENT_TYPES.map(t => `
      <div class="event-card event-card--${t.id}" data-tourney-card="${t.id}" data-emoji="${t.emoji}">
        <div class="event-card__top">
          <span class="event-card__icon" aria-hidden="true">${t.emoji}</span>
          <span class="event-card__badge" data-badge>${t.size} игроков</span>
        </div>
        <div>
          <div class="event-card__title">${esc(t.title)}</div>
          <div class="event-card__desc">${esc(t.desc)}</div>
        </div>
        <div class="event-card__facts">
          <span class="event-fact">👥 <b>${t.size}</b> игроков</span>
          <span class="event-fact">🎯 <b>${t.questions}</b> вопросов в матче</span>
          <span class="event-fact">🪙 <b>${t.prize}</b> чемпиону</span>
        </div>
        <button class="event-card__btn" type="button" disabled>Загрузка…</button>
      </div>
    `).join('');
    if (window.LexPrepMotion) LexPrepMotion.stagger(listEl, '.event-card');

    TOURNAMENT_TYPES.forEach(t => {
      const card = listEl.querySelector(`[data-tourney-card="${t.id}"]`);
      const btn = card.querySelector('button');
      btn.addEventListener('click', async () => {
        const state = cardState[t.id];
        if (!state) return;
        if (state.mode === 'continue') {
          enterTournamentFlow(t.id);
          return;
        }
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
    });
  }

  // Обновляет кнопки/значки карточек на месте — без перерисовки (иначе
  // опрос раз в несколько секунд перезапускал бы анимации).
  async function refreshList() {
    for (const t of TOURNAMENT_TYPES) {
      const card = listEl.querySelector(`[data-tourney-card="${t.id}"]`);
      if (!card) continue;
      const btn = card.querySelector('button');
      const badge = card.querySelector('[data-badge]');
      let state = null;
      try {
        state = await LexPrepApi.getMyTournamentState(t.id);
      } catch (e) { /* гость/ошибка сети — считаем, что не участвует */ }

      if (state && state.tournament.status !== 'completed') {
        cardState[t.id] = { mode: 'continue' };
        card.classList.add('is-joined');
        badge.textContent = state.tournament.status === 'open' ? 'Ты в лобби' : 'Идёт турнир';
        badge.classList.add('is-live');
        btn.disabled = false;
        btn.textContent = '▶ Продолжить';
        continue;
      }

      card.classList.remove('is-joined');
      badge.textContent = `${t.size} игроков`;
      badge.classList.remove('is-live');
      const allowance = tournamentAllowance();
      cardState[t.id] = { mode: 'join' };
      btn.disabled = !allowance.allowed;
      btn.textContent = !allowance.allowed
        ? allowance.label
        : (allowance.usesTicket ? 'Участвовать (билет сверх лимита)' : '⚔️ Участвовать');
    }
  }

  buildList();
  refreshList();

  /* ---------------- Ожидание: лобби / готовность / между раундами ---------------- */
  const waitingTitleEl = document.getElementById('tourneyWaitingTitle');
  const waitingMsgEl = document.getElementById('tourneyWaitingMsg');
  const waitingStageEl = document.getElementById('tourneyWaitingStage');
  const readyBtn = document.getElementById('tourneyReadyBtn');
  const bracketWrap = document.getElementById('tourneyBracketWrap');
  const bracketEl = document.getElementById('tourneyBracket');

  let pollTimer = null;
  let battleTickTimer = null;
  let currentTypeId = null;
  let currentMatch = null;
  let currentTournament = null;
  let battleQuestions = [];
  let battleScore = 0;
  let battleFinished = false;
  let renderedIndex = -1;
  let lockedIndex = -1;
  let battleChosen = [];
  let stageSignature = '';
  let bracketSignature = '';

  let progressPollTimer = null;
  let myProgress = 0;
  let oppProgress = 0;
  // Что именно сейчас показывает экран "waiting" — от этого зависит,
  // что должна делать кнопка "К списку турниров"/"Сдаться": в лобби —
  // по-настоящему выйти из очереди, на экране готовности — сдать матч,
  // между раундами — просто уйти с экрана, само участие не трогая.
  let waitingStage = null;

  function stopTimers() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (battleTickTimer) { clearInterval(battleTickTimer); battleTickTimer = null; }
    if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
  }

  // Этап ожидания перерисовывается только при реальных изменениях.
  function setStage(signature, html) {
    if (signature === stageSignature) return;
    stageSignature = signature;
    waitingStageEl.innerHTML = html;
  }

  async function enterTournamentFlow(typeId) {
    currentTypeId = typeId;
    stageSignature = '';
    bracketSignature = '';
    stopTimers();
    await refreshTournamentFlow();
    pollTimer = setInterval(refreshTournamentFlow, 2000);
  }

  /* ---- Сетка турнира ---- */
  async function renderBracket(tournament, target, wrap) {
    let matches = [];
    try {
      matches = await LexPrepApi.listTournamentMatches(tournament.id);
    } catch (e) {
      return;
    }
    const ids = [];
    matches.forEach(m => ids.push(m.player1Id, m.player2Id));
    await ensureProfiles(ids);
    const signature = JSON.stringify([matches, tournament.status, tournament.winnerId, tournament.currentRound]);
    if (target === bracketEl && signature === bracketSignature) return;
    if (target === bracketEl) bracketSignature = signature;

    const totalRounds = Math.round(Math.log2(tournament.size || 2));
    const rounds = [];
    for (let r = 1; r <= totalRounds; r++) {
      const slots = (tournament.size || 2) / Math.pow(2, r);
      const cells = [];
      for (let s = 1; s <= slots; s++) {
        // slot в базе нумеруется с 1 (см. supabase/tournaments.sql).
        cells.push(matches.find(x => x.round === r && x.slot === s) || null);
      }
      rounds.push({ r, cells });
    }

    const playerRow = (m, which) => {
      const id = which === 1 ? m.player1Id : m.player2Id;
      const score = which === 1 ? m.player1Score : m.player2Score;
      const done = m.status === 'completed';
      const isWinner = done && m.winnerId === id;
      return `
        <div class="bracket-player ${isWinner ? 'is-winner' : ''} ${done && !isWinner ? 'is-loser' : ''} ${id === user.id ? 'is-me' : ''}">
          <span class="bracket-player__name">${esc(shortName(id))}</span>
          <span class="bracket-player__score">${score == null ? '' : score}</span>
        </div>`;
    };

    target.innerHTML = rounds.map(({ r, cells }) => `
      <div class="bracket__round">
        <div class="bracket__round-title">${esc(roundName(r, tournament.size))}</div>
        ${cells.map(m => m ? `
          <div class="bracket-match ${m.player1Id === user.id || m.player2Id === user.id ? 'is-mine' : ''} ${m.status === 'active' ? 'is-live' : ''}">
            ${playerRow(m, 1)}
            ${playerRow(m, 2)}
          </div>` : `
          <div class="bracket-match">
            <div class="bracket-player bracket-player--tbd"><span class="bracket-player__name">ждём победителя</span></div>
            <div class="bracket-player bracket-player--tbd"><span class="bracket-player__name">ждём победителя</span></div>
          </div>`).join('')}
      </div>
    `).join('') + (tournament.status === 'completed' && tournament.winnerId ? `
      <div class="bracket__round">
        <div class="bracket__round-title">Чемпион</div>
        <div class="bracket-champion"><span aria-hidden="true">👑</span><span>${esc(shortName(tournament.winnerId))}</span></div>
      </div>` : '');
    if (wrap) wrap.hidden = false;
    if (window.LexPrepMotion && target.dataset.animated !== '1') {
      target.dataset.animated = '1';
      LexPrepMotion.stagger(target, '.bracket-match, .bracket-champion');
    }
  }

  async function refreshTournamentFlow() {
    let state;
    try {
      state = await LexPrepApi.getMyTournamentState(currentTypeId);
    } catch (e) { return; }

    if (!state) {
      stopTimers();
      showView('list');
      refreshList();
      return;
    }

    const { tournament, eliminatedRound, match, lobbyCount } = state;
    currentTournament = tournament;

    if (tournament.status === 'completed') {
      stopTimers();
      showFinalResult(tournament, eliminatedRound);
      return;
    }

    if (eliminatedRound) {
      stopTimers();
      showEliminated(tournament, eliminatedRound);
      return;
    }

    const waitingBackBtn = document.getElementById('tourneyWaitingBackBtn');

    if (tournament.status === 'open') {
      waitingStage = 'lobby';
      showView('waiting');
      readyBtn.hidden = true;
      bracketWrap.hidden = true;
      waitingBackBtn.textContent = 'Выйти из очереди';
      waitingTitleEl.textContent = 'Собираем участников…';
      waitingMsgEl.textContent = 'Турнир начнётся автоматически, как только лобби заполнится.';
      await renderLobby(tournament, lobbyCount);
      return;
    }

    // status === 'active'
    if (!match) {
      waitingStage = 'between-rounds';
      showView('waiting');
      readyBtn.hidden = true;
      waitingBackBtn.textContent = 'К списку турниров';
      waitingTitleEl.textContent = roundName(tournament.currentRound, tournament.size);
      waitingMsgEl.textContent = 'Ждём, пока доиграют остальные пары и сформируется следующий матч…';
      setStage(`between-${tournament.currentRound}`, `
        <div class="lobby__hourglass" aria-hidden="true">⏳</div>
        <span class="arena-page-head__eyebrow">Ты прошёл дальше!</span>`);
      renderBracket(tournament, bracketEl, bracketWrap);
      return;
    }

    currentMatch = match;

    if (match.status === 'pending') {
      waitingStage = 'ready';
      waitingBackBtn.textContent = 'Сдаться';
      stopTimers();
      pollTimer = setInterval(refreshTournamentFlow, 1500);
      showView('waiting');
      const iAmP1 = match.player1Id === user.id;
      const oppId = iAmP1 ? match.player2Id : match.player1Id;
      const iAmReady = iAmP1 ? match.player1Ready : match.player2Ready;
      const oppReady = iAmP1 ? match.player2Ready : match.player1Ready;
      await ensureProfiles([oppId]);
      waitingTitleEl.textContent = `${roundName(tournament.currentRound, tournament.size)} — твой матч`;
      waitingMsgEl.textContent = oppReady
        ? 'Соперник готов — начинайте, как только нажмёшь «Готов».'
        : (iAmReady ? 'Ты готов, ждём соперника…' : 'Нажми «Готов», когда будешь готов начать одновременно с соперником.');
      setStage(`ready-${match.id}-${iAmReady}-${oppReady}-${profileCache.has(oppId)}`, `
        <div class="arena-ready">
          <div class="arena-ready__side">
            ${Arena.fighterHtml(Arena.me(user))}
            <span class="arena-ready__flag ${iAmReady ? 'is-ready' : ''}">${iAmReady ? '✓ Готов' : 'Не готов'}</span>
          </div>
          <div class="arena-ready__vs"><span>VS</span></div>
          <div class="arena-ready__side">
            ${Arena.fighterHtml(playerFor(oppId))}
            <span class="arena-ready__flag ${oppReady ? 'is-ready' : ''}">${oppReady ? '✓ Готов' : 'ждём…'}</span>
          </div>
        </div>`);
      readyBtn.hidden = false;
      readyBtn.disabled = iAmReady;
      readyBtn.textContent = iAmReady ? 'Ты готов' : 'Готов!';
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
      renderBracket(tournament, bracketEl, bracketWrap);
      return;
    }

    if (match.status === 'active' && !battleTickTimer) {
      stopTimers();
      beginBattle(tournament, match);
    }
  }

  async function renderLobby(tournament, lobbyCount) {
    let participants = [];
    try {
      participants = await LexPrepApi.listTournamentParticipants(tournament.id);
    } catch (e) { /* покажем только счётчик */ }
    await ensureProfiles(participants.map(p => p.userId));
    const count = participants.length || lobbyCount || 0;
    const slots = Array.from({ length: tournament.size }, (_, i) => participants[i] || null);
    setStage(`lobby-${count}-${participants.map(p => p.userId).join(',')}-${participants.filter(p => profileCache.get(p.userId)).length}`, `
      <div class="lobby__counter">${count}<span>/ ${tournament.size}</span></div>
      <div class="lobby__slots">
        ${slots.map(p => p ? `
          <div class="lobby-slot">
            ${Arena.avatarHtml(playerFor(p.userId, 'Игрок'), 'arena-avatar--lg')}
            <span class="lobby-slot__name">${esc(shortName(p.userId))}</span>
          </div>` : `
          <div class="lobby-slot">
            <span class="lobby-slot__empty">?</span>
            <span class="lobby-slot__name">свободно</span>
          </div>`).join('')}
      </div>`);
  }

  /* ---------------- Матч (общий таймер на вопрос) ---------------- */
  const questionBox = document.getElementById('tourneyQuestionBox');
  const roundResultEl = document.getElementById('tourneyRoundResult');
  const answerBtn = document.getElementById('tourneyAnswerBtn');
  let hud = null;
  let shownOppProgress = 0;
  let myStreak = 0;

  function syncOpponentProgress() {
    if (!hud) return;
    while (shownOppProgress < Math.min(oppProgress, battleQuestions.length)) {
      hud.pip('right', shownOppProgress, 'done');
      shownOppProgress++;
    }
    if (renderedIndex >= 0) {
      const oppDone = oppProgress > renderedIndex;
      hud.status('right', oppDone ? 'ответил ✓' : 'думает…', oppDone ? 'ok' : 'think');
    }
  }

  function beginBattle(tournament, match) {
    battleQuestions = DuelEngine.resolveQuestions(DATA, match.questionIds);
    battleScore = 0;
    battleFinished = false;
    renderedIndex = -1;
    lockedIndex = -1;
    shownOppProgress = 0;
    myStreak = 0;

    const iAmP1 = match.player1Id === user.id;
    const oppId = iAmP1 ? match.player2Id : match.player1Id;
    hud = Arena.buildHud(document.getElementById('tourneyHud'), {
      left: Arena.me(user),
      right: { ...playerFor(oppId), hiddenScore: true },
      total: battleQuestions.length,
      timer: true,
      roundLabel: 'Вопрос'
    });

    showView('battle');
    Arena.flash(roundName(tournament.currentRound, tournament.size));
    Arena.vibrate(40);

    const startedAtMs = new Date(match.startedAt).getTime();
    const durationMs = tournament.secondsPerQuestion * 1000;
    myProgress = 0;
    oppProgress = 0;

    progressPollTimer = setInterval(async () => {
      try {
        const fresh = await LexPrepApi.getTournamentMatch(match.id);
        oppProgress = iAmP1 ? fresh.player2Progress : fresh.player1Progress;
        syncOpponentProgress();
      } catch (e) { /* пропустим один опрос */ }
    }, 800);

    function tick() {
      const elapsed = Date.now() - startedAtMs;
      const timeIndex = Math.floor(elapsed / durationMs);
      const bothAnsweredIndex = Math.min(myProgress, oppProgress);
      const index = Math.max(timeIndex, bothAnsweredIndex);

      if (index >= battleQuestions.length) {
        markMissedUpTo(battleQuestions.length);
        finishBattle(match);
        return;
      }

      if (index !== renderedIndex) {
        markMissedUpTo(index);
        renderQuestion(index);
      }

      const remainingMs = durationMs - (elapsed % durationMs);
      hud.setTimer(Math.max(0, remainingMs / 1000), tournament.secondsPerQuestion);
    }

    tick();
    battleTickTimer = setInterval(tick, 250);
  }

  function markMissedUpTo(index) {
    if (hud && renderedIndex >= 0 && renderedIndex < index && lockedIndex !== renderedIndex) {
      hud.pip('left', renderedIndex, 'miss');
      myStreak = 0;
    }
  }

  function renderQuestion(index) {
    renderedIndex = index;
    battleChosen = [];
    roundResultEl.hidden = true;
    answerBtn.textContent = 'Ответить';
    answerBtn.disabled = true;

    const item = battleQuestions[index];
    hud.setRound(index);
    hud.status('left', 'твой ход', 'turn');
    syncOpponentProgress();
    questionBox.innerHTML = Arena.questionHtml(item, index, 'tourney-answer');
    Arena.animateIn(questionBox);

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
    myStreak = correct ? myStreak + 1 : 0;

    myProgress = index + 1;
    if (currentMatch) LexPrepApi.advanceTournamentMatchProgress(currentMatch.id, myProgress).catch(() => {});

    Arena.revealAnswers(questionBox, item.question.correct, battleChosen);
    answerBtn.disabled = true;
    Arena.vibrate(correct ? 25 : [20, 40, 20]);

    hud.pip('left', index, correct ? 'ok' : 'bad');
    hud.setScore('left', battleScore);
    hud.status('left', correct ? 'верно!' : 'мимо', correct ? 'ok' : 'bad');
    if (correct) {
      hud.hit('left');
      hud.pop('left', myStreak >= 2 ? `🔥 ×${myStreak}` : '+1', 'ok');
    } else {
      hud.miss('left');
    }

    roundResultEl.hidden = false;
    roundResultEl.innerHTML = `
      <div class="arena-feedback__verdicts">
        <span class="arena-verdict ${correct ? 'is-ok' : 'is-bad'}">${battleChosen.length ? (correct ? 'Верно' : 'Неверно') : 'Время вышло'}</span>
        <span class="arena-verdict is-wait">Следующий вопрос — когда ответит соперник или кончится время</span>
      </div>
      <p class="duel-round-result__explain">${esc(item.question.explanation)}</p>
    `;
    Arena.animateIn(roundResultEl);
  }

  answerBtn.addEventListener('click', () => lockCurrentAnswer(renderedIndex));

  document.getElementById('tourneyBattleForfeitBtn').addEventListener('click', async () => {
    if (battleFinished) return;
    if (!(await LexPrepDialog.confirm('Сдаться в этом матче? Незавершённые вопросы будут засчитаны как неотвеченные.'))) return;
    finishBattle(currentMatch);
  });

  async function finishBattle(match) {
    if (battleFinished) return;
    battleFinished = true;
    stopTimers();
    waitingStage = 'between-rounds';
    showView('waiting');
    readyBtn.hidden = true;
    waitingTitleEl.textContent = 'Матч завершён';
    waitingMsgEl.textContent = `Твой результат: ${battleScore} из ${battleQuestions.length}. Отправляем и ждём соперника…`;
    setStage(`sent-${match.id}`, `
      <div class="lobby__hourglass" aria-hidden="true">📨</div>
      <div class="lobby__counter">${battleScore}<span>/ ${battleQuestions.length}</span></div>`);

    try {
      await LexPrepApi.submitTournamentScore(match.id, battleScore);
    } catch (err) {
      alert(err.message);
    }
    pollTimer = setInterval(refreshTournamentFlow, 1500);
    refreshTournamentFlow();
  }

  /* ---------------- Итог ---------------- */
  const resultEl = document.getElementById('tourneyResult');
  const resultBracketWrap = document.getElementById('tourneyResultBracketWrap');
  const resultBracketEl = document.getElementById('tourneyResultBracket');

  function showEliminated(tournament, eliminatedRound) {
    showView('results');
    document.getElementById('tourneyResultTitle').textContent = `Выбывание — ${roundName(eliminatedRound, tournament.size)}`;
    document.getElementById('tourneyResultMsg').textContent = '';
    resultEl.innerHTML = Arena.resultHtml({
      outcome: 'out',
      title: 'Выбывание',
      subtitle: `${roundName(eliminatedRound, tournament.size)}: в этот раз соперник оказался сильнее. Спасибо за игру!`
    });
    Arena.playResult(resultEl, 'out');
    resultBracketEl.dataset.animated = '';
    renderBracket(tournament, resultBracketEl, resultBracketWrap);
  }

  function showFinalResult(tournament, eliminatedRound) {
    showView('results');
    const titleEl = document.getElementById('tourneyResultTitle');
    const msgEl = document.getElementById('tourneyResultMsg');
    const isChampion = tournament.winnerId === user.id;

    if (isChampion) {
      titleEl.textContent = 'Чемпион турнира!';
      msgEl.textContent = '';
      resultEl.innerHTML = Arena.resultHtml({
        outcome: 'champion',
        title: 'Чемпион!',
        subtitle: 'Вся сетка пройдена — ты лучший в этом турнире.',
        rewards: [{ icon: '🪙', label: 'монет на баланс', value: tournament.prizeCoins, tone: 'up' }]
      });
      Arena.playResult(resultEl, 'champion');
      LexPrepApi.me().then(fresh => {
        localStorage.setItem('lexprep_user', JSON.stringify(fresh));
        if (typeof initCoinBadge === 'function') initCoinBadge();
      }).catch(() => {});
    } else {
      titleEl.textContent = `Турнир завершён — выбывание в раунде ${eliminatedRound || '?'}`;
      msgEl.textContent = '';
      resultEl.innerHTML = Arena.resultHtml({
        outcome: 'out',
        title: 'Турнир завершён',
        subtitle: eliminatedRound
          ? `Выбывание: ${roundName(eliminatedRound, tournament.size)}. Попробуй в следующем турнире!`
          : 'В этот раз не получилось дойти до финала — попробуй в следующем турнире.'
      });
      Arena.playResult(resultEl, 'out');
    }
    resultBracketEl.dataset.animated = '';
    renderBracket(tournament, resultBracketEl, resultBracketWrap);
  }

  document.getElementById('tourneyBackBtn').addEventListener('click', () => {
    stopTimers();
    showView('list');
    refreshList();
  });
  document.getElementById('tourneyWaitingBackBtn').addEventListener('click', async () => {
    const backBtn = document.getElementById('tourneyWaitingBackBtn');
    // Раньше эта кнопка просто уводила с экрана, ничего не меняя на
    // сервере — из очереди/начатого матча по факту выйти было нельзя,
    // только сделать вид. Теперь она по-настоящему выходит из очереди
    // (лобби) или сдаёт матч (экран готовности); между раундами сетки
    // уже не отвертеться — там просто уходим со страницы, участие
    // остаётся, продолжить можно позже через "Продолжить" в списке.
    if (waitingStage === 'lobby') {
      if (!(await LexPrepDialog.confirm('Выйти из очереди на турнир?'))) return;
      backBtn.disabled = true;
      try {
        await LexPrepApi.leaveTournamentLobby(currentTypeId);
      } catch (err) {
        alert(err.message);
        backBtn.disabled = false;
        return;
      }
      backBtn.disabled = false;
    } else if (waitingStage === 'ready') {
      if (!(await LexPrepDialog.confirm('Сдаться в этом матче? Победа будет засчитана сопернику.'))) return;
      backBtn.disabled = true;
      try {
        await LexPrepApi.forfeitTournamentMatch(currentMatch.id);
      } catch (err) {
        alert(err.message);
        backBtn.disabled = false;
        return;
      }
      backBtn.disabled = false;
    }
    stopTimers();
    showView('list');
    refreshList();
  });

  showView('list');

  // Экран списка типов турниров раньше обновлялся только при заходе на
  // страницу — если чей-то турнир только что заполнился, кнопка
  // "Участвовать" не менялась на "Продолжить" без ручного обновления
  // страницы. Опрашиваем, пока список реально виден.
  setInterval(() => {
    const listView = document.querySelector('[data-tourney-view="list"]');
    if (listView && !listView.hidden) refreshList();
  }, 6000);
});
