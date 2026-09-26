/* ==========================================================================
DUEL-PVP.JS — дуэль 1 на 1 против реального игрока. Открытое лобби:
вызов создаётся без конкретного соперника, любой другой пользователь
принимает его из списка. Дальше оба играют один и тот же набор вопросов
с общим таймером и отправляют счёт — сервер сам считает победителя и
дуэльный рейтинг (см. supabase/duels.sql). Отображение — arena.js.
========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user || typeof LexPrepApi === 'undefined') return;
  await (window.LexPrepContentReady || Promise.resolve());

  const DATA = LEXPREP_DATA;

  /* ---------------- Режим: бот / игрок ---------------- */
  const modeTabs = document.querySelectorAll('[data-duel-mode-tab]');
  const modePanels = document.querySelectorAll('[data-duel-mode-panel]');
  let pvpInited = false;

  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.duelModeTab;
      modeTabs.forEach(t => {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      modePanels.forEach(p => { p.hidden = p.dataset.duelModePanel !== mode; });
      const panel = document.querySelector(`[data-duel-mode-panel="${mode}"]`);
      Arena.animateIn(panel, 'arena-enter');
      if (mode === 'pvp' && !pvpInited) {
        pvpInited = true;
        initPvp();
      }
    });
  });

  const escapeHtml = Arena.esc;

  function disciplineLabel(id) {
    if (!id || id === 'all') return 'Все дисциплины';
    const d = DATA.find(d => d.id === id);
    return d ? d.title : id;
  }

  function formatDateTime(iso) {
    try {
      return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function resolveQuestions(questionIds) {
    return DuelEngine.resolveQuestions(DATA, questionIds);
  }

  function initPvp() {
    const discSelect = document.getElementById('pvpDiscipline');
    const topicSelect = document.getElementById('pvpTopic');
    const countSelect = document.getElementById('pvpCount');
    const createBtn = document.getElementById('pvpCreateBtn');
    const errorEl = document.getElementById('pvpSetupError');
    const statsEl = document.getElementById('pvpStats');
    const openListEl = document.getElementById('pvpOpenList');
    const myListEl = document.getElementById('pvpMyList');

    discSelect.innerHTML = `<option value="all">Все дисциплины</option>` +
      DATA.map(d => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('');

    function renderTopicOptions() {
      const discId = discSelect.value;
      if (discId === 'all') {
        topicSelect.innerHTML = `<option value="all">Все темы</option>`;
        topicSelect.disabled = true;
        return;
      }
      const discipline = DATA.find(d => d.id === discId);
      topicSelect.disabled = false;
      topicSelect.innerHTML = `<option value="all">Все темы дисциплины</option>` +
        (discipline ? discipline.topics.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('') : '');
    }
    discSelect.addEventListener('change', renderTopicOptions);
    renderTopicOptions();

    function ratingChip(value) {
      return `<span aria-hidden="true">⚔️</span><b>${value}</b><span>рейтинг PvP</span>`;
    }

    function renderStats() {
      statsEl.innerHTML = ratingChip(user.duelRating || 1000);
      LexPrepApi.me().then(fresh => {
        user.duelRating = fresh.duelRating;
        statsEl.innerHTML = ratingChip(fresh.duelRating);
      }).catch(() => {});
    }
    renderStats();

    const STATUS_LABEL = { open: 'Ищем соперника', accepted: 'Идёт', completed: 'Завершена', cancelled: 'Отменена' };

    // Аватары соперников подгружаются по мере появления новых id.
    const profileCache = new Map();
    async function ensureProfiles(ids) {
      const missing = ids.filter(id => id && !profileCache.has(id));
      if (!missing.length) return false;
      const loaded = await Arena.loadProfiles(missing);
      missing.forEach(id => profileCache.set(id, loaded.get(id) || null));
      return loaded.size > 0;
    }

    function playerFor(id, fallbackName, meta) {
      const p = Arena.fromProfile(profileCache.get(id), fallbackName, meta);
      return p;
    }

    let lastOpenList = [];

    function renderOpenList(list) {
      lastOpenList = list;
      const others = list.filter(d => d.challengerId !== user.id);
      if (!others.length) {
        openListEl.innerHTML = `
          <div class="arena-empty">
            <span class="arena-empty__icon" aria-hidden="true">🏟️</span>
            <p>Пока никто не бросил вызов — создай свой, и соперник найдётся.</p>
          </div>`;
        return;
      }
      openListEl.innerHTML = others.map(d => {
        const meta = [
          d.challengerLevel ? `Ур. ${d.challengerLevel}` : '',
          d.challengerRating ? `⚔️ ${d.challengerRating}` : ''
        ].filter(Boolean).join(' · ');
        const player = playerFor(d.challengerId, d.challengerName || 'Игрок', meta);
        return `
          <div class="challenge-card">
            ${Arena.avatarHtml(player, 'arena-avatar--md')}
            <div class="challenge-card__info">
              <div class="challenge-card__name">${escapeHtml(player.name)}</div>
              <div class="challenge-card__meta">${escapeHtml(meta || player.meta || '')}</div>
              <div class="challenge-card__tags">
                <span class="arena-tag">📚 ${escapeHtml(disciplineLabel(d.discipline))}</span>
                <span class="arena-tag">🎯 ${d.questionCount} раундов</span>
                <span class="arena-tag arena-tag--muted">${formatDateTime(d.createdAt)}</span>
              </div>
            </div>
            <button type="button" class="arena-accept" data-accept="${d.id}">⚔️ Принять</button>
          </div>
        `;
      }).join('');

      openListEl.querySelectorAll('[data-accept]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!checkDuelAllowance()) return;
          btn.disabled = true;
          try {
            const duel = await LexPrepApi.acceptDuelChallenge(btn.dataset.accept);
            await refreshLists();
            playDuel(duel);
          } catch (err) {
            alert(err.message);
            btn.disabled = false;
          }
        });
      });
    }

    function renderMyList(fullList) {
      if (!fullList.length) {
        myListEl.innerHTML = `
          <div class="arena-empty">
            <span class="arena-empty__icon" aria-hidden="true">⚔️</span>
            <p>Ты ещё не создавал и не принимал дуэли.</p>
          </div>`;
        return;
      }
      // Активные (открытые/идущие) — нужны все, они требуют действия.
      // Завершённые — только последние 5, иначе список бесконечно растёт
      // историей сыгранных дуэлей.
      const active = fullList.filter(d => d.status !== 'completed' && d.status !== 'cancelled');
      const finished = fullList.filter(d => d.status === 'completed' || d.status === 'cancelled').slice(0, 5);
      const list = [...active, ...finished];

      myListEl.innerHTML = list.map(d => {
        const isChallenger = d.challengerId === user.id;
        const myScore = isChallenger ? d.challengerScore : d.opponentScore;
        const oppScore = isChallenger ? d.opponentScore : d.challengerScore;
        const myDelta = isChallenger ? d.challengerRatingDelta : d.opponentRatingDelta;
        const myPlayed = isChallenger ? d.challengerPlayedAt : d.opponentPlayedAt;
        const oppId = isChallenger ? d.opponentId : d.challengerId;
        const oppName = (isChallenger ? d.opponentName : d.challengerName) || 'Соперник';

        // Свой открытый вызов — «радар»: ищем соперника.
        if (d.status === 'open' && isChallenger) {
          return `
            <div class="search-card">
              <div class="search-card__radar" aria-hidden="true">
                <span class="search-card__ring"></span><span class="search-card__ring"></span><span class="search-card__ring"></span>
                ${Arena.avatarHtml(Arena.me(user), 'arena-avatar--md')}
              </div>
              <div class="search-card__info">
                <div class="search-card__title">Ищем соперника…</div>
                <div class="challenge-card__tags">
                  <span class="arena-tag">📚 ${escapeHtml(disciplineLabel(d.discipline))}</span>
                  <span class="arena-tag">🎯 ${d.questionCount} раундов</span>
                </div>
              </div>
              <button type="button" class="arena-link-btn" data-cancel="${d.id}">Отменить</button>
            </div>`;
        }

        let action = '';
        let state = '';
        if (d.status === 'accepted' && !myPlayed) {
          action = `<button type="button" class="arena-accept" data-play="${d.id}">▶ Играть</button>`;
          state = 'is-live';
        } else if (d.status === 'accepted' && myPlayed) {
          action = `<span class="arena-tag arena-tag--wait">⏳ ждём соперника</span>`;
        }

        let resultLine = '';
        if (d.status === 'completed') {
          const outcome = myScore > oppScore ? 'win' : myScore < oppScore ? 'loss' : 'draw';
          const label = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' }[outcome];
          state = `is-${outcome}`;
          resultLine = `
            <span class="history-card__score">${myScore} : ${oppScore}</span>
            <span class="history-card__outcome">${label}</span>
            <span class="history-card__delta ${myDelta >= 0 ? 'is-up' : 'is-down'}">${myDelta >= 0 ? '+' : ''}${myDelta}</span>`;
        } else if (d.status === 'cancelled') {
          state = 'is-cancelled';
          resultLine = '<span class="history-card__outcome">Отменена</span>';
        }

        const opponent = playerFor(oppId, oppId ? oppName : '?', '');
        return `
          <div class="history-card ${state}">
            ${oppId ? Arena.avatarHtml(opponent, 'arena-avatar--sm') : '<span class="arena-avatar arena-avatar--sm arena-avatar--ghost">?</span>'}
            <div class="history-card__info">
              <div class="history-card__name">${oppId ? `vs ${escapeHtml(oppName)}` : 'Соперник ещё не найден'}</div>
              <div class="history-card__meta">${escapeHtml(disciplineLabel(d.discipline))} · ${d.questionCount} раундов · ${formatDateTime(d.createdAt)}</div>
            </div>
            <div class="history-card__right">${resultLine || `<span class="arena-tag">${STATUS_LABEL[d.status]}</span>`}${action}</div>
          </div>
        `;
      }).join('');

      myListEl.querySelectorAll('[data-play]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!checkDuelAllowance()) return;
          const duel = myDuelsCache.find(d => d.id === btn.dataset.play);
          if (duel) playDuel(duel);
        });
      });
      myListEl.querySelectorAll('[data-cancel]').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await LexPrepApi.cancelDuelChallenge(btn.dataset.cancel);
            await refreshLists();
          } catch (err) {
            alert(err.message);
            btn.disabled = false;
          }
        });
      });
    }

    let myDuelsCache = [];
    let listsRendered = false;
    let listsSignature = '';

    async function refreshLists() {
      try {
        const [openList, myList] = await Promise.all([LexPrepApi.listOpenDuels(), LexPrepApi.listMyDuels()]);
        myDuelsCache = myList;
        // Перерисовываем только если что-то изменилось — иначе опрос раз в
        // 5 секунд перезапускал бы анимации карточек («радар» поиска).
        const signature = JSON.stringify([openList, myList]);
        if (signature !== listsSignature) {
          listsSignature = signature;
          renderOpenList(openList);
          renderMyList(myList);
        }
        if (!listsRendered && window.LexPrepMotion) {
          listsRendered = true;
          LexPrepMotion.stagger(openListEl, '.challenge-card');
          LexPrepMotion.stagger(myListEl, '.history-card, .search-card');
        }
        // Аватары соперников — после первого рендера, чтобы не ждать сеть.
        const ids = [
          ...openList.map(d => d.challengerId),
          ...myList.map(d => (d.challengerId === user.id ? d.opponentId : d.challengerId))
        ];
        if (await ensureProfiles(ids)) {
          renderOpenList(lastOpenList);
          renderMyList(myDuelsCache);
        }
      } catch (err) {
        openListEl.innerHTML = `<p class="community-empty">Не удалось загрузить: ${escapeHtml(err.message)}</p>`;
        myListEl.innerHTML = '';
      }
    }

    function checkDuelAllowance() {
      if (user.isAdmin || user.isModerator) return true;
      const limit = LexPrepPlan.getLimits().duelsPerDay;
      if (limit === 0) {
        errorEl.textContent = 'Дуэли доступны с тарифа «Про» — оформи подписку в магазине.';
        errorEl.hidden = false;
        return false;
      }
      if (LexPrepProgress.getDailyUsage().duelsPlayed >= limit) {
        errorEl.textContent = `Дневной лимит дуэлей (${limit}) на тарифе «${LexPrepPlan.TIER_TITLES[LexPrepPlan.getTier()]}» исчерпан — попробуй завтра или оформи «Максимум».`;
        errorEl.hidden = false;
        return false;
      }
      return true;
    }

    createBtn.addEventListener('click', async () => {
      errorEl.hidden = true;
      if (!checkDuelAllowance()) return;
      const disciplineId = discSelect.value;
      const topicId = topicSelect.value;
      const count = Number(countSelect.value);

      const picked = DuelEngine.pickQuestions(DATA, count, disciplineId, topicId);
      if (picked.length < count) {
        errorEl.textContent = 'В выбранной теме недостаточно вопросов — выбери другую тему или дисциплину «Все».';
        errorEl.hidden = false;
        return;
      }

      createBtn.disabled = true;
      try {
        const myLevel = (typeof LexPrepProgress !== 'undefined' && LexPrepProgress.getGamification().level) || 1;
        await LexPrepApi.createDuelChallenge({
          discipline: disciplineId,
          topic: topicId,
          questionIds: picked.map(p => ({ topicId: p.topicId, qIndex: p.qIndex })),
          questionCount: count,
          challengerName: (user.name || 'Игрок').trim(),
          challengerLevel: myLevel,
          challengerRating: user.duelRating || 1000
        });
        await refreshLists();
        myListEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      } finally {
        createBtn.disabled = false;
      }
    });

    /* ---------------- Battle (синхронный старт, общий таймер на вопрос) ----------------
       Оба игрока жмут "Готов" (duel_mark_ready) — как только готовы оба,
       сервер фиксирует started_at один раз для обоих. Дальше каждый
       клиент независимо считает текущий вопрос и остаток времени по
       формуле elapsed = Date.now() - startedAt — без обмена сообщениями
       оба видят один и тот же вопрос в одно и то же время. Вопрос
       переключается по истечении времени НЕЗАВИСИМО от того, ответил
       игрок или нет (как в Kahoot) — если не успел, засчитывается как
       неверный. */
    const pvpViews = document.querySelectorAll('[data-pvp-view]');
    function showPvpView(name) {
      pvpViews.forEach(v => { v.hidden = v.dataset.pvpView !== name; });
      document.body.classList.toggle('arena-in-game', name !== 'lobby');
      Arena.animateIn(document.querySelector(`[data-pvp-view="${name}"]`), 'arena-enter');
      window.scrollTo({ top: 0, behavior: Arena.reduced() ? 'auto' : 'smooth' });
    }

    let battleDuel = null;
    let battleQuestions = [];
    let battleScore = 0;
    let battleFinished = false;
    let renderedIndex = -1;
    let lockedIndex = -1;
    let battleChosen = [];
    let readyPollTimer = null;
    let battleTickTimer = null;
    let hud = null;
    let mePlayer = null;
    let oppPlayer = null;
    let shownOppProgress = 0;
    let myStreak = 0;

    const questionBox = document.getElementById('pvpQuestionBox');
    const roundResultEl = document.getElementById('pvpRoundResult');
    const answerBtn = document.getElementById('pvpAnswerBtn');
    const readyBtn = document.getElementById('pvpReadyBtn');
    const readyStatusEl = document.getElementById('pvpReadyStatus');
    const readyStageEl = document.getElementById('pvpReadyStage');

    function stopTimers() {
      if (readyPollTimer) { clearInterval(readyPollTimer); readyPollTimer = null; }
      if (battleTickTimer) { clearInterval(battleTickTimer); battleTickTimer = null; }
      if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
    }

    // Сдаться завершает дуэль СРАЗУ поражением, а не просто отправляет
    // свой счёт пораньше (это была бы обычная отправка, ждущая, пока
    // соперник тоже отправит свой — соперник как ни в чём не бывало
    // доигрывал бы матч, не зная, что оппонент уже сдался).
    async function forfeitDuel() {
      if (!battleDuel || battleFinished) return;
      if (!(await LexPrepDialog.confirm('Сдаться в этой дуэли? Победа сразу засчитается сопернику.'))) return;
      battleFinished = true;
      stopTimers();
      try {
        const result = await LexPrepApi.forfeitDuel(battleDuel.id);
        finishBattle(result);
      } catch (err) {
        alert(err.message);
        showPvpView('lobby');
        await refreshLists();
      }
    }

    document.getElementById('pvpForfeitBtn').addEventListener('click', forfeitDuel);
    document.getElementById('pvpBattleForfeitBtn').addEventListener('click', forfeitDuel);

    function opponentOf(duel) {
      const isChallenger = duel.challengerId === user.id;
      const oppId = isChallenger ? duel.opponentId : duel.challengerId;
      const oppName = (isChallenger ? duel.opponentName : duel.challengerName) || 'Соперник';
      const meta = !isChallenger && duel.challengerRating ? `⚔️ ${duel.challengerRating}` : '';
      return { id: oppId, player: playerFor(oppId, oppName, meta) };
    }

    function renderReadyStage(duel) {
      const iAmReady = amChallenger() ? duel.challengerReady : duel.opponentReady;
      const oppReady = amChallenger() ? duel.opponentReady : duel.challengerReady;
      readyStageEl.innerHTML = `
        <div class="arena-ready__side">
          ${Arena.fighterHtml(mePlayer)}
          <span class="arena-ready__flag ${iAmReady ? 'is-ready' : ''}">${iAmReady ? '✓ Готов' : 'Не готов'}</span>
        </div>
        <div class="arena-ready__vs"><span>VS</span></div>
        <div class="arena-ready__side">
          ${Arena.fighterHtml(oppPlayer)}
          <span class="arena-ready__flag ${oppReady ? 'is-ready' : ''}">${oppReady ? '✓ Готов' : 'ждём…'}</span>
        </div>
      `;
    }

    function playDuel(duel) {
      battleDuel = duel;
      battleQuestions = resolveQuestions(duel.questionIds);
      battleScore = 0;
      battleFinished = false;
      renderedIndex = -1;
      lockedIndex = -1;
      mePlayer = Arena.me(user, user.duelRating ? `⚔️ ${user.duelRating}` : undefined);
      const opp = opponentOf(duel);
      oppPlayer = opp.player;
      showPvpView('ready');
      readyBtn.disabled = false;
      readyBtn.textContent = 'Готов!';
      renderReadyStage(duel);
      updateReadyStatus(duel);
      // Если карточки соперника ещё нет — подгружаем и перерисовываем VS.
      ensureProfiles([opp.id]).then(changed => {
        if (!changed || battleDuel !== duel) return;
        oppPlayer = opponentOf(battleDuel).player;
        renderReadyStage(battleDuel);
      });

      readyBtn.onclick = async () => {
        readyBtn.disabled = true;
        try {
          const updated = await LexPrepApi.markDuelReady(duel.id);
          battleDuel = updated;
          if (updated.startedAt) {
            LexPrepProgress.incrementDailyUsage('duelsPlayed');
            beginBattle();
          } else {
            renderReadyStage(updated);
            updateReadyStatus(updated);
            waitForStart();
          }
        } catch (err) {
          alert(err.message);
          readyBtn.disabled = false;
        }
      };

      waitForStart();
    }

    function amChallenger() {
      return battleDuel.challengerId === user.id;
    }

    function updateReadyStatus(duel) {
      const iAmReady = amChallenger() ? duel.challengerReady : duel.opponentReady;
      const oppReady = amChallenger() ? duel.opponentReady : duel.challengerReady;
      if (iAmReady) readyBtn.textContent = 'Ты готов — ждём соперника';
      readyStatusEl.textContent = oppReady
        ? 'Соперник готов — начинаем, как только нажмёшь «Готов».'
        : iAmReady
          ? 'Ты готов, ждём соперника…'
          : 'Нажми «Готов», когда будешь готов начать одновременно с соперником.';
    }

    function waitForStart() {
      stopTimers();
      readyPollTimer = setInterval(async () => {
        try {
          const duel = await LexPrepApi.getDuel(battleDuel.id);
          battleDuel = duel;
          if (duel.status === 'completed') {
            // Соперник сдался, пока мы ещё не начали — незачем ждать
            // дальше, показываем итог сразу.
            stopTimers();
            battleFinished = true;
            finishBattle(duel);
            return;
          }
          if (duel.startedAt) {
            stopTimers();
            LexPrepProgress.incrementDailyUsage('duelsPlayed');
            beginBattle();
          } else {
            renderReadyStage(duel);
            updateReadyStatus(duel);
          }
        } catch (e) { /* временная сетевая ошибка — просто попробуем ещё раз */ }
      }, 1500);
    }

    // Часы боя уже идут с момента started_at, поэтому вместо долгой
    // заставки — короткая вспышка «В бой!» поверх уже открытого вопроса.
    function beginBattle() {
      hud = Arena.buildHud(document.getElementById('pvpHud'), {
        left: mePlayer,
        right: { ...oppPlayer, hiddenScore: true },
        total: battleQuestions.length,
        timer: true
      });
      shownOppProgress = 0;
      myStreak = 0;
      showPvpView('battle');
      Arena.flash('В бой!');
      Arena.vibrate(40);
      startBattleClock();
    }

    let myProgress = 0;
    let oppProgress = 0;
    let progressPollTimer = null;

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

    function startBattleClock() {
      const startedAtMs = new Date(battleDuel.startedAt).getTime();
      const durationMs = battleDuel.secondsPerQuestion * 1000;
      myProgress = 0;
      oppProgress = 0;

      // Отдельный, более редкий опрос сервера за прогрессом соперника —
      // сама перерисовка вопроса идёт от локального tick() каждые 250мс,
      // не дожидаясь сети.
      progressPollTimer = setInterval(async () => {
        try {
          const fresh = await LexPrepApi.getDuel(battleDuel.id);
          if (fresh.status === 'completed' && !battleFinished) {
            // Соперник сдался прямо во время боя — не заставляем
            // доигрывать матч, которого уже нет.
            battleFinished = true;
            stopTimers();
            finishBattle(fresh);
            return;
          }
          oppProgress = amChallenger() ? fresh.opponentProgress : fresh.challengerProgress;
          syncOpponentProgress();
        } catch (e) { /* пропустим один опрос — не критично */ }
      }, 800);

      function tick() {
        const elapsed = Date.now() - startedAtMs;
        const timeIndex = Math.floor(elapsed / durationMs);
        // Если оба уже ответили на текущий вопрос — не ждём остаток
        // времени, сразу переходим дальше.
        const bothAnsweredIndex = Math.min(myProgress, oppProgress);
        const index = Math.max(timeIndex, bothAnsweredIndex);

        if (index >= battleQuestions.length) {
          markMissedUpTo(battleQuestions.length);
          finishBattleClock();
          return;
        }

        if (index !== renderedIndex) {
          markMissedUpTo(index);
          renderBattleQuestion(index);
        }

        const remainingMs = durationMs - (elapsed % durationMs);
        hud.setTimer(Math.max(0, remainingMs / 1000), battleDuel.secondsPerQuestion);
      }

      tick();
      battleTickTimer = setInterval(tick, 250);
    }

    // Вопрос, на который игрок не успел ответить до смены, — «мимо».
    function markMissedUpTo(index) {
      if (renderedIndex >= 0 && renderedIndex < index && lockedIndex !== renderedIndex) {
        hud.pip('left', renderedIndex, 'miss');
        myStreak = 0;
      }
    }

    function lockCurrentAnswer(index) {
      if (lockedIndex === index) return;
      lockedIndex = index;
      const item = battleQuestions[index];
      const correct = DuelEngine.sameAnswerSet(battleChosen, item.question.correct);
      if (correct) battleScore++;
      myStreak = correct ? myStreak + 1 : 0;

      myProgress = index + 1;
      LexPrepApi.advanceDuelProgress(battleDuel.id, myProgress).catch(() => {});

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
        <p class="duel-round-result__explain">${escapeHtml(item.question.explanation)}</p>
      `;
      Arena.animateIn(roundResultEl);
    }

    function renderBattleQuestion(index) {
      renderedIndex = index;
      battleChosen = [];
      roundResultEl.hidden = true;
      answerBtn.textContent = 'Ответить';
      answerBtn.disabled = true;

      const item = battleQuestions[index];
      hud.setRound(index);
      hud.status('left', 'твой ход', 'turn');
      syncOpponentProgress();
      questionBox.innerHTML = Arena.questionHtml(item, index, 'pvp-answer');
      Arena.animateIn(questionBox);

      questionBox.querySelectorAll('input[name="pvp-answer"]').forEach(input => {
        input.addEventListener('change', () => {
          battleChosen = Array.from(questionBox.querySelectorAll('input[name="pvp-answer"]:checked')).map(el => Number(el.value));
          answerBtn.disabled = battleChosen.length === 0;
        });
      });
    }

    answerBtn.addEventListener('click', () => {
      lockCurrentAnswer(renderedIndex);
    });

    async function finishBattleClock() {
      if (battleFinished) return;
      battleFinished = true;
      stopTimers();
      // Вопросы, которые игрок не успел явно "ответить" до истечения
      // общего времени, уже не засчитаны в battleScore (lockCurrentAnswer
      // на них не вызывался) — они корректно идут как неверные.
      try {
        const result = await LexPrepApi.submitDuelScore(battleDuel.id, battleScore);
        finishBattle(result);
      } catch (err) {
        alert(err.message);
        showPvpView('lobby');
        await refreshLists();
      }
    }

    function finishBattle(result) {
      const titleEl = document.getElementById('pvpResultTitle');
      const msgEl = document.getElementById('pvpResultMsg');
      const detailsEl = document.getElementById('pvpResultDetails');
      const me = mePlayer || Arena.me(user);

      if (result.status === 'completed') {
        const isChallenger = result.challengerId === user.id;
        const myScore = isChallenger ? result.challengerScore : result.opponentScore;
        const oppScore = isChallenger ? result.opponentScore : result.challengerScore;
        const myDelta = isChallenger ? result.challengerRatingDelta : result.opponentRatingDelta;
        const oppName = (isChallenger ? result.opponentName : result.challengerName) || 'Соперник';
        const opponent = oppPlayer || playerFor(isChallenger ? result.opponentId : result.challengerId, oppName, '');
        const outcome = myScore > oppScore ? 'win' : myScore < oppScore ? 'loss' : 'draw';

        titleEl.textContent = { win: 'Победа!', loss: 'Поражение', draw: 'Ничья' }[outcome];
        msgEl.textContent = '';
        detailsEl.innerHTML = Arena.resultHtml({
          outcome,
          subtitle: outcome === 'win' ? `${oppName} повержен(а) в честной дуэли!` : outcome === 'loss' ? 'Соперник оказался сильнее — возьми реванш.' : 'Равный бой — рейтинг почти не изменился.',
          left: me,
          right: opponent,
          leftScore: myScore,
          rightScore: oppScore,
          rewards: [
            { icon: '⚔️', label: 'рейтинг PvP', value: myDelta || 0, tone: (myDelta || 0) >= 0 ? 'up' : 'down' }
          ]
        });
        Arena.playResult(detailsEl, outcome);
      } else {
        titleEl.textContent = `Ты ответил на ${battleScore} из ${battleQuestions.length}`;
        msgEl.textContent = 'Соперник ещё не доиграл — результат и изменение рейтинга появятся в «Моих дуэлях», как только он закончит.';
        detailsEl.innerHTML = Arena.resultHtml({
          outcome: 'wait',
          title: `${battleScore} из ${battleQuestions.length}`,
          subtitle: 'Твой результат отправлен',
          left: me,
          right: oppPlayer || { name: 'Соперник', tone: 'red' },
          leftScore: battleScore,
          rightScore: null
        });
      }

      showPvpView('results');
      refreshLists();
      renderStats();
    }

    document.getElementById('pvpBackToLobbyBtn').addEventListener('click', () => {
      stopTimers();
      showPvpView('lobby');
    });

    refreshLists();
    // Списки открытых/своих дуэлей раньше обновлялись только вручную
    // (после действия) — если открытый вызов появлялся или соперник
    // доигрывал, пока страница просто лежала открытой, узнать об этом
    // можно было только вручную обновив страницу. Опрашиваем сами.
    setInterval(refreshLists, 5000);
  }
});
