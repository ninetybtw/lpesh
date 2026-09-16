/* ==========================================================================
DUEL-PVP.JS — дуэль 1 на 1 против реального игрока. Открытое лобби:
вызов создаётся без конкретного соперника, любой другой пользователь
принимает его из списка. Дальше оба играют один и тот же набор вопросов
независимо (как в тренажёре) и отправляют счёт — сервер сам считает
победителя и дуэльный рейтинг (см. supabase/duels.sql).
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
      modeTabs.forEach(t => t.classList.toggle('is-active', t === tab));
      modePanels.forEach(p => { p.hidden = p.dataset.duelModePanel !== mode; });
      if (mode === 'pvp' && !pvpInited) {
        pvpInited = true;
        initPvp();
      }
    });
  });

  function escapeHtml(str) {
    return DuelEngine.escapeHtml(str);
  }

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

    function renderStats() {
      statsEl.innerHTML = `
        <div class="duel-stats__item duel-stats__item--rating"><span class="duel-stats__num">${user.duelRating || 1000}</span><span class="duel-stats__label">рейтинг PvP</span></div>
      `;
      LexPrepApi.me().then(fresh => {
        user.duelRating = fresh.duelRating;
        statsEl.innerHTML = `
          <div class="duel-stats__item duel-stats__item--rating"><span class="duel-stats__num">${fresh.duelRating}</span><span class="duel-stats__label">рейтинг PvP</span></div>
        `;
      }).catch(() => {});
    }
    renderStats();

    const STATUS_LABEL = { open: 'Открыт', accepted: 'Идёт', completed: 'Завершена', cancelled: 'Отменена' };

    function renderOpenList(list) {
      const others = list.filter(d => d.challengerId !== user.id);
      if (!others.length) {
        openListEl.innerHTML = '<p class="community-empty">Пока никто не создал открытый вызов — стань первым.</p>';
        return;
      }
      openListEl.innerHTML = others.map(d => `
        <div class="community-item">
          <div class="community-item__head">
            <h3>${escapeHtml(disciplineLabel(d.discipline))} · ${d.questionCount} вопросов</h3>
            <span class="community-badge community-badge--open">${STATUS_LABEL[d.status]}</span>
          </div>
          <div class="community-item__meta">
            <span>Создал: ${escapeHtml(d.challengerName || 'Игрок')}${d.challengerLevel ? ` · ур. ${d.challengerLevel}` : ''}${d.challengerRating ? ` · рейтинг ${d.challengerRating}` : ''} · ${formatDateTime(d.createdAt)}</span>
            <button type="button" class="admin-action-btn" data-accept="${d.id}">Принять</button>
          </div>
        </div>
      `).join('');

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

    function renderMyList(list) {
      if (!list.length) {
        myListEl.innerHTML = '<p class="community-empty">Ты ещё не создавал и не принимал дуэли.</p>';
        return;
      }
      myListEl.innerHTML = list.map(d => {
        const isChallenger = d.challengerId === user.id;
        const myScore = isChallenger ? d.challengerScore : d.opponentScore;
        const oppScore = isChallenger ? d.opponentScore : d.challengerScore;
        const myDelta = isChallenger ? d.challengerRatingDelta : d.opponentRatingDelta;
        const myPlayed = isChallenger ? d.challengerPlayedAt : d.opponentPlayedAt;

        let action = '';
        if (d.status === 'open' && isChallenger) {
          action = `<button type="button" class="admin-action-btn admin-action-btn--warn" data-cancel="${d.id}">Отменить</button>`;
        } else if (d.status === 'accepted' && !myPlayed) {
          action = `<button type="button" class="admin-action-btn" data-play="${d.id}">Играть</button>`;
        } else if (d.status === 'accepted' && myPlayed) {
          action = `<span class="community-badge community-badge--reviewing">Ждём соперника</span>`;
        }

        let resultLine = '';
        if (d.status === 'completed') {
          const outcome = myScore > oppScore ? 'Победа' : myScore < oppScore ? 'Поражение' : 'Ничья';
          resultLine = `<span>${myScore} : ${oppScore} — ${outcome} (${myDelta >= 0 ? '+' : ''}${myDelta} рейтинга)</span>`;
        }

        return `
          <div class="community-item">
            <div class="community-item__head">
              <h3>${escapeHtml(disciplineLabel(d.discipline))} · ${d.questionCount} вопросов</h3>
              <span class="community-badge community-badge--${d.status === 'accepted' ? 'reviewing' : d.status === 'completed' ? 'accepted' : d.status === 'cancelled' ? 'rejected' : 'open'}">${STATUS_LABEL[d.status]}</span>
            </div>
            <div class="community-item__meta">
              ${resultLine || `<span>${formatDateTime(d.createdAt)}</span>`}
              ${action}
            </div>
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

    async function refreshLists() {
      try {
        const [openList, myList] = await Promise.all([LexPrepApi.listOpenDuels(), LexPrepApi.listMyDuels()]);
        myDuelsCache = myList;
        renderOpenList(openList);
        renderMyList(myList);
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

    const progressEl = document.getElementById('pvpProgress');
    const topicLabelEl = document.getElementById('pvpTopicLabel');
    const questionBox = document.getElementById('pvpQuestionBox');
    const roundResultEl = document.getElementById('pvpRoundResult');
    const answerBtn = document.getElementById('pvpAnswerBtn');
    const readyBtn = document.getElementById('pvpReadyBtn');
    const readyStatusEl = document.getElementById('pvpReadyStatus');

    function stopTimers() {
      if (readyPollTimer) { clearInterval(readyPollTimer); readyPollTimer = null; }
      if (battleTickTimer) { clearInterval(battleTickTimer); battleTickTimer = null; }
      if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
    }

    // Сдаться — на экране готовности отправляет счёт 0 (ещё никто не
    // отвечал), во время боя — текущий набранный счёт (не обнуляет то,
    // что уже честно отвечено). В обоих случаях засчитывается как обычная
    // отправка счёта — сервер сам решит исход, как только другая сторона
    // тоже отправит свой (или автоматически спишет её как выбывшую по
    // таймауту, если она давно не отвечает — см. duel_submit_score).
    async function forfeitDuel() {
      if (!battleDuel || battleFinished) return;
      if (!confirm('Сдаться в этой дуэли? Незавершённые вопросы будут засчитаны как неотвеченные.')) return;
      battleFinished = true;
      stopTimers();
      try {
        const result = await LexPrepApi.submitDuelScore(battleDuel.id, battleScore);
        finishBattle(result);
      } catch (err) {
        alert(err.message);
        showPvpView('lobby');
        await refreshLists();
      }
    }

    document.getElementById('pvpForfeitBtn').addEventListener('click', forfeitDuel);
    document.getElementById('pvpBattleForfeitBtn').addEventListener('click', forfeitDuel);

    function playDuel(duel) {
      battleDuel = duel;
      battleQuestions = resolveQuestions(duel.questionIds);
      battleScore = 0;
      battleFinished = false;
      renderedIndex = -1;
      lockedIndex = -1;
      showPvpView('ready');
      readyBtn.disabled = false;
      readyBtn.textContent = 'Готов';
      updateReadyStatus(duel);

      readyBtn.onclick = async () => {
        readyBtn.disabled = true;
        try {
          const updated = await LexPrepApi.markDuelReady(duel.id);
          battleDuel = updated;
          if (updated.startedAt) {
            LexPrepProgress.incrementDailyUsage('duelsPlayed');
            showPvpView('battle');
            startBattleClock();
          } else {
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
          if (duel.startedAt) {
            stopTimers();
            LexPrepProgress.incrementDailyUsage('duelsPlayed');
            showPvpView('battle');
            startBattleClock();
          } else {
            updateReadyStatus(duel);
          }
        } catch (e) { /* временная сетевая ошибка — просто попробуем ещё раз */ }
      }, 1500);
    }

    let myProgress = 0;
    let oppProgress = 0;
    let progressPollTimer = null;

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
          oppProgress = amChallenger() ? fresh.opponentProgress : fresh.challengerProgress;
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
          finishBattleClock();
          return;
        }

        if (index !== renderedIndex) {
          renderBattleQuestion(index);
        }

        const remainingSec = Math.max(0, Math.ceil((durationMs - (elapsed % durationMs)) / 1000));
        progressEl.textContent = `Вопрос ${index + 1} из ${battleQuestions.length} · осталось ${remainingSec}с`;
      }

      tick();
      battleTickTimer = setInterval(tick, 250);
    }

    function lockCurrentAnswer(index) {
      if (lockedIndex === index) return;
      lockedIndex = index;
      const item = battleQuestions[index];
      const correct = DuelEngine.sameAnswerSet(battleChosen, item.question.correct);
      if (correct) battleScore++;

      myProgress = index + 1;
      LexPrepApi.advanceDuelProgress(battleDuel.id, myProgress).catch(() => {});

      questionBox.querySelectorAll('input[name="pvp-answer"]').forEach(input => { input.disabled = true; });
      answerBtn.disabled = true;

      roundResultEl.hidden = false;
      roundResultEl.innerHTML = `
        <span class="${correct ? 'duel-round-result__ok' : 'duel-round-result__bad'}">${battleChosen.length ? (correct ? 'Верно' : 'Неверно') : 'Время вышло'}</span>
        <p class="duel-round-result__explain">${escapeHtml(item.question.explanation)}</p>
      `;
    }

    function renderBattleQuestion(index) {
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
              <input type="${isMulti ? 'checkbox' : 'radio'}" name="pvp-answer" value="${i}">
              <span>${escapeHtml(option)}</span>
            </label>
          `).join('')}
        </div>
      `;

      questionBox.classList.remove('is-animating');
      void questionBox.offsetWidth;
      questionBox.classList.add('is-animating');

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

      if (result.status === 'completed') {
        const isChallenger = result.challengerId === user.id;
        const myScore = isChallenger ? result.challengerScore : result.opponentScore;
        const oppScore = isChallenger ? result.opponentScore : result.challengerScore;
        const delta = isChallenger ? result.challengerRatingDelta : result.opponentRatingDelta;
        const outcome = myScore > oppScore ? 'Победа' : myScore < oppScore ? 'Поражение' : 'Ничья';
        titleEl.textContent = `${outcome}: ${myScore} : ${oppScore}`;
        msgEl.textContent = `Изменение дуэльного рейтинга: ${delta >= 0 ? '+' : ''}${delta}.`;
      } else {
        titleEl.textContent = `Ты ответил на ${battleScore} из ${battleQuestions.length}`;
        msgEl.textContent = 'Соперник ещё не доиграл — результат и изменение рейтинга появятся здесь, как только он закончит (проверь во вкладке «Мои дуэли»).';
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
