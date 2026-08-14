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
    return questionIds.map(({ topicId, qIndex }) => {
      for (const d of DATA) {
        const t = d.topics.find(t => t.id === topicId);
        if (t && t.test[qIndex]) {
          return { topicId: t.id, topicTitle: t.title, disciplineTitle: d.title, qIndex, question: t.test[qIndex] };
        }
      }
      return null;
    }).filter(Boolean);
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
            <span>${formatDateTime(d.createdAt)}</span>
            <button type="button" class="admin-action-btn" data-accept="${d.id}">Принять</button>
          </div>
        </div>
      `).join('');

      openListEl.querySelectorAll('[data-accept]').forEach(btn => {
        btn.addEventListener('click', async () => {
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

    createBtn.addEventListener('click', async () => {
      errorEl.hidden = true;
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
        await LexPrepApi.createDuelChallenge({
          discipline: disciplineId,
          topic: topicId,
          questionIds: picked.map(p => ({ topicId: p.topicId, qIndex: p.qIndex })),
          questionCount: count
        });
        await refreshLists();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      } finally {
        createBtn.disabled = false;
      }
    });

    /* ---------------- Battle (соло-прохождение) ---------------- */
    const pvpViews = document.querySelectorAll('[data-pvp-view]');
    function showPvpView(name) {
      pvpViews.forEach(v => { v.hidden = v.dataset.pvpView !== name; });
    }

    let battleDuel = null;
    let battleQuestions = [];
    let battleIndex = 0;
    let battleScore = 0;
    let battleAnswered = false;
    let battleChosen = null;

    const progressEl = document.getElementById('pvpProgress');
    const topicLabelEl = document.getElementById('pvpTopicLabel');
    const questionBox = document.getElementById('pvpQuestionBox');
    const roundResultEl = document.getElementById('pvpRoundResult');
    const answerBtn = document.getElementById('pvpAnswerBtn');

    function playDuel(duel) {
      battleDuel = duel;
      battleQuestions = resolveQuestions(duel.questionIds);
      battleIndex = 0;
      battleScore = 0;
      showPvpView('battle');
      renderBattleQuestion();
    }

    function renderBattleQuestion() {
      battleAnswered = false;
      battleChosen = null;
      roundResultEl.hidden = true;
      answerBtn.textContent = 'Ответить';
      answerBtn.disabled = true;

      const item = battleQuestions[battleIndex];
      progressEl.textContent = `Вопрос ${battleIndex + 1} из ${battleQuestions.length}`;
      topicLabelEl.textContent = `${item.disciplineTitle} → ${item.topicTitle}`;

      questionBox.innerHTML = `
        <h4>${escapeHtml(item.question.question)}</h4>
        <div class="answers">
          ${item.question.options.map((option, i) => `
            <label class="answer">
              <input type="radio" name="pvp-answer" value="${i}">
              <span>${escapeHtml(option)}</span>
            </label>
          `).join('')}
        </div>
      `;

      questionBox.querySelectorAll('input[name="pvp-answer"]').forEach(input => {
        input.addEventListener('change', () => {
          battleChosen = Number(input.value);
          answerBtn.disabled = false;
        });
      });
    }

    answerBtn.addEventListener('click', async () => {
      if (!battleAnswered) {
        battleAnswered = true;
        const item = battleQuestions[battleIndex];
        const correct = battleChosen === item.question.correct;
        if (correct) battleScore++;

        questionBox.querySelectorAll('input[name="pvp-answer"]').forEach(input => { input.disabled = true; });

        roundResultEl.hidden = false;
        roundResultEl.innerHTML = `
          <span class="${correct ? 'duel-round-result__ok' : 'duel-round-result__bad'}">${correct ? 'Верно' : 'Неверно'}</span>
          <p class="duel-round-result__explain">${escapeHtml(item.question.explanation)}</p>
        `;

        answerBtn.textContent = battleIndex === battleQuestions.length - 1 ? 'Завершить' : 'Следующий вопрос →';
        return;
      }

      if (battleIndex < battleQuestions.length - 1) {
        battleIndex++;
        renderBattleQuestion();
      } else {
        answerBtn.disabled = true;
        try {
          const result = await LexPrepApi.submitDuelScore(battleDuel.id, battleScore);
          finishBattle(result);
        } catch (err) {
          alert(err.message);
          showPvpView('lobby');
          await refreshLists();
        }
      }
    });

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
      showPvpView('lobby');
    });

    refreshLists();
  }
});
