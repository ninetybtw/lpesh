/* ==========================================================================
DUEL.JS — дуэль 1 на 1 против бота: выбор соперника/темы/раундов/ставки,
раунд за раундом сравнение ответов игрока и бота, начисление монет и
дуэльного рейтинга по итогу. Соперник — бот (демо), не реальный игрок.
Отображение «как в игре» (заставка VS, табло, эффекты) — в arena.js.
========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }
  await (window.LexPrepContentReady || Promise.resolve());

  const DATA = LEXPREP_DATA;
  const views = document.querySelectorAll('[data-duel-view]');
  const esc = Arena.esc;

  function showView(name) {
    views.forEach(v => { v.hidden = v.dataset.duelView !== name; });
    // В бою и на итогах — «игровой режим»: без шапки, выбора режима и
    // нижнего меню, только табло, вопрос и кнопка.
    document.body.classList.toggle('arena-in-game', name !== 'setup');
    const active = document.querySelector(`[data-duel-view="${name}"]`);
    Arena.animateIn(active, 'arena-enter');
    window.scrollTo({ top: 0, behavior: Arena.reduced() ? 'auto' : 'smooth' });
  }

  const WAGER_PRESETS = [10, 25, 50, 100];
  const BOTS = {
    easy: { emoji: '🐣', name: 'Бот-стажёр', power: 1, hint: 'Ошибается часто' },
    medium: { emoji: '🤖', name: 'Бот-юрист', power: 2, hint: 'Честный соперник' },
    hard: { emoji: '👾', name: 'Бот-судья', power: 3, hint: 'Почти не ошибается' }
  };
  const RATING_DELTA = { win: 18, loss: -12, draw: 2 };

  /* ---------------- Шапка арены ---------------- */
  const profileEl = document.getElementById('arenaProfile');

  function renderProfile() {
    const stats = LexPrepProgress.getDuelStats();
    const player = Arena.me(user);
    const played = stats.wins + stats.losses + stats.draws;
    const winRate = played ? Math.round((stats.wins / played) * 100) : 0;
    profileEl.innerHTML = `
      <div class="arena-profile__me">
        <div class="arena-fighter__avatar-wrap">${Arena.avatarHtml(player, 'arena-avatar--lg')}${Arena.rankBadge(player)}</div>
        <div class="arena-profile__info">
          <span class="arena-profile__eyebrow">Арена</span>
          <span class="arena-profile__name">${esc(player.name)}</span>
          <span class="arena-profile__meta">${esc(player.meta)}</span>
        </div>
        <div class="arena-profile__rating">
          <span class="arena-profile__rating-num">${stats.rating}</span>
          <span class="arena-profile__rating-label">рейтинг</span>
        </div>
      </div>
      <div class="arena-profile__stats" id="duelStats">
        <div class="arena-stat arena-stat--win"><b>${stats.wins}</b><span>побед</span></div>
        <div class="arena-stat arena-stat--loss"><b>${stats.losses}</b><span>поражений</span></div>
        <div class="arena-stat"><b>${stats.draws}</b><span>ничьих</span></div>
        <div class="arena-stat arena-stat--rate"><b>${winRate}%</b><span>винрейт</span></div>
      </div>
    `;
  }

  /* ---------------- Настройка боя ---------------- */
  const disciplineSelect = document.getElementById('duelDiscipline');
  const topicSelect = document.getElementById('duelTopic');
  const difficultySelect = document.getElementById('duelDifficulty');
  const countSelect = document.getElementById('duelCount');
  const wagerInput = document.getElementById('duelWager');
  const wagerHint = document.getElementById('duelWagerHint');
  const balanceEl = document.getElementById('duelBalance');
  const errorEl = document.getElementById('duelSetupError');
  const botPicker = document.getElementById('botPicker');

  disciplineSelect.innerHTML = `<option value="all">Все дисциплины</option>` +
    DATA.map(d => `<option value="${d.id}">${esc(d.title)}</option>`).join('');

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
      (discipline ? discipline.topics.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('') : '');
  }

  disciplineSelect.addEventListener('change', renderTopicOptions);
  renderTopicOptions();

  // Соперник — карточки ботов вместо выпадающего списка.
  botPicker.innerHTML = Object.keys(BOTS).map(key => {
    const bot = BOTS[key];
    const diff = DuelEngine.DIFFICULTIES[key];
    return `
      <button type="button" class="bot-card bot-card--${key} ${difficultySelect.value === key ? 'is-active' : ''}" data-bot="${key}">
        <span class="bot-card__avatar" aria-hidden="true">${bot.emoji}</span>
        <span class="bot-card__name">${esc(bot.name)}</span>
        <span class="bot-card__level">${esc(diff.label)}</span>
        <span class="bot-card__power" aria-label="Сила ${bot.power} из 3">
          ${[1, 2, 3].map(n => `<i class="${n <= bot.power ? 'is-on' : ''}"></i>`).join('')}
        </span>
        <span class="bot-card__hint">${esc(bot.hint)}</span>
      </button>`;
  }).join('');
  botPicker.querySelectorAll('[data-bot]').forEach(card => {
    card.addEventListener('click', () => {
      difficultySelect.value = card.dataset.bot;
      botPicker.querySelectorAll('[data-bot]').forEach(c => c.classList.toggle('is-active', c === card));
    });
  });

  // Сегменты «Раундов» синхронизируются со скрытым <select>.
  document.querySelectorAll('[data-seg-for]').forEach(seg => {
    const select = document.getElementById(seg.dataset.segFor);
    seg.querySelectorAll('[data-value]').forEach(btn => {
      btn.addEventListener('click', () => {
        select.value = btn.dataset.value;
        seg.querySelectorAll('[data-value]').forEach(b => b.classList.toggle('is-active', b === btn));
      });
    });
  });

  function renderBalance() {
    balanceEl.textContent = LexPrepProgress.getCoins();
    if (typeof initCoinBadge === 'function') initCoinBadge();
  }

  function renderWagerHint() {
    const wager = Math.floor(Number(wagerInput.value)) || 0;
    wagerHint.textContent = wager > 0 ? `Победа: +${wager} 🪙 · ничья: ставка вернётся` : '';
    document.querySelectorAll('[data-wager]').forEach(b => b.classList.toggle('is-active', Number(b.dataset.wager) === wager));
  }

  const presetsEl = document.getElementById('duelWagerPresets');
  presetsEl.innerHTML = WAGER_PRESETS.map(v => `<button type="button" class="arena-chip" data-wager="${v}">${v} 🪙</button>`).join('');
  presetsEl.querySelectorAll('[data-wager]').forEach(btn => {
    btn.addEventListener('click', () => {
      wagerInput.value = btn.dataset.wager;
      renderWagerHint();
    });
  });
  wagerInput.addEventListener('input', renderWagerHint);

  renderProfile();
  renderBalance();
  renderWagerHint();

  function showError(text) {
    errorEl.textContent = text;
    errorEl.hidden = false;
    Arena.animateIn(errorEl, 'arena-shake');
  }

  document.getElementById('startDuelBtn').addEventListener('click', () => {
    errorEl.hidden = true;

    const duelLimit = LexPrepPlan.getLimits().duelsPerDay;
    if (duelLimit === 0) {
      showError('Дуэли доступны с тарифа «Про» — оформи подписку в магазине.');
      return;
    }
    if (LexPrepProgress.getDailyUsage().duelsPlayed >= duelLimit) {
      showError(`Дневной лимит дуэлей (${duelLimit}) на тарифе «${LexPrepPlan.TIER_TITLES[LexPrepPlan.getTier()]}» исчерпан — попробуй завтра или оформи «Максимум».`);
      return;
    }

    const count = Number(countSelect.value);
    const difficulty = difficultySelect.value;
    const disciplineId = disciplineSelect.value;
    const topicId = topicSelect.value;
    const wager = Math.floor(Number(wagerInput.value));

    const balance = LexPrepProgress.getCoins();
    if (!wager || wager < 1) {
      showError('Укажи ставку от 1 монеты.');
      return;
    }
    if (wager > balance) {
      showError(`Не хватает монет: на балансе ${balance}, а ставка ${wager}.`);
      return;
    }

    const questions = DuelEngine.pickQuestions(DATA, count, disciplineId, topicId);
    if (questions.length < count) {
      showError('В выбранной теме недостаточно вопросов — выбери другую тему или дисциплину «Все».');
      return;
    }

    if (!LexPrepProgress.spendCoins(wager)) {
      showError('Не удалось списать ставку — попробуй ещё раз.');
      return;
    }
    if (typeof initCoinBadge === 'function') initCoinBadge();
    LexPrepProgress.incrementDailyUsage('duelsPlayed');

    startDuel(questions, wager, difficulty);
  });

  /* ---------------- Бой ---------------- */
  let duelQuestions = [];
  let duelWager = 0;
  let duelDifficulty = 'medium';
  let currentIndex = 0;
  let playerScore = 0;
  let botScore = 0;
  let playerStreak = 0;
  let answered = false;
  let chosen = [];
  let hud = null;
  let botPlayer = null;
  let mePlayer = null;
  const roundLog = [];

  const questionBox = document.getElementById('duelQuestionBox');
  const roundResultEl = document.getElementById('duelRoundResult');
  const answerBtn = document.getElementById('duelAnswerBtn');

  async function startDuel(questions, wager, difficulty) {
    duelQuestions = questions;
    duelWager = wager;
    duelDifficulty = difficulty;
    currentIndex = 0;
    playerScore = 0;
    botScore = 0;
    playerStreak = 0;
    roundLog.length = 0;

    const bot = BOTS[difficulty] || BOTS.medium;
    mePlayer = Arena.me(user);
    botPlayer = {
      name: bot.name,
      emoji: bot.emoji,
      meta: `${DuelEngine.DIFFICULTIES[difficulty].label} · ставка ${wager} 🪙`,
      tone: 'red'
    };

    hud = Arena.buildHud(document.getElementById('duelHud'), {
      left: mePlayer,
      right: botPlayer,
      total: questions.length,
      timer: false
    });

    await Arena.vsIntro({ left: mePlayer, right: botPlayer, title: 'Дуэль', subtitle: `${questions.length} раундов · ставка ${wager} 🪙` });
    showView('battle');
    renderQuestion();
  }

  function renderQuestion() {
    answered = false;
    chosen = [];
    roundResultEl.hidden = true;
    answerBtn.textContent = 'Ответить';
    answerBtn.disabled = true;

    const item = duelQuestions[currentIndex];
    hud.setRound(currentIndex);
    hud.status('left', 'твой ход', 'turn');
    hud.status('right', 'думает…', 'think');
    questionBox.innerHTML = Arena.questionHtml(item, currentIndex, 'duel-answer');
    Arena.animateIn(questionBox);

    questionBox.querySelectorAll('input[name="duel-answer"]').forEach(input => {
      input.addEventListener('change', () => {
        chosen = Array.from(questionBox.querySelectorAll('input[name="duel-answer"]:checked')).map(el => Number(el.value));
        answerBtn.disabled = chosen.length === 0;
      });
    });
  }

  answerBtn.addEventListener('click', () => {
    if (!answered) {
      answered = true;
      answerBtn.disabled = true;
      const item = duelQuestions[currentIndex];
      const playerCorrect = DuelEngine.sameAnswerSet(chosen, item.question.correct);
      const botCorrect = DuelEngine.botAnswerCorrect(duelDifficulty);
      if (playerCorrect) playerScore++;
      if (botCorrect) botScore++;
      playerStreak = playerCorrect ? playerStreak + 1 : 0;
      roundLog.push({ item, chosen, playerCorrect, botCorrect });

      Arena.revealAnswers(questionBox, item.question.correct, chosen);
      Arena.vibrate(playerCorrect ? 25 : [20, 40, 20]);

      // Сначала ход игрока, чуть позже — ответ бота.
      hud.pip('left', currentIndex, playerCorrect ? 'ok' : 'bad');
      hud.setScore('left', playerScore);
      hud.status('left', playerCorrect ? 'верно!' : 'мимо', playerCorrect ? 'ok' : 'bad');
      if (playerCorrect) {
        hud.hit('left');
        hud.pop('left', playerStreak >= 2 ? `🔥 ×${playerStreak}` : '+1', 'ok');
      } else {
        hud.miss('left');
      }

      setTimeout(() => {
        hud.pip('right', currentIndex, botCorrect ? 'ok' : 'bad');
        hud.setScore('right', botScore);
        hud.status('right', botCorrect ? 'верно' : 'ошибся', botCorrect ? 'ok' : 'bad');
        if (botCorrect) {
          hud.hit('right');
          hud.pop('right', '+1', 'bad');
        } else {
          hud.miss('right');
        }
      }, Arena.reduced() ? 0 : 650);

      roundResultEl.hidden = false;
      roundResultEl.innerHTML = `
        <div class="arena-feedback__verdicts">
          <span class="arena-verdict ${playerCorrect ? 'is-ok' : 'is-bad'}">Ты: ${playerCorrect ? 'верно' : 'неверно'}</span>
          <span class="arena-verdict ${botCorrect ? 'is-ok' : 'is-bad'}">${esc(botPlayer.name)}: ${botCorrect ? 'верно' : 'неверно'}</span>
        </div>
        <p class="duel-round-result__explain">${esc(item.question.explanation)}</p>
      `;
      Arena.animateIn(roundResultEl);

      answerBtn.textContent = currentIndex === duelQuestions.length - 1 ? 'Завершить дуэль' : 'Следующий раунд →';
      setTimeout(() => { answerBtn.disabled = false; }, Arena.reduced() ? 0 : 700);
      return;
    }

    if (currentIndex < duelQuestions.length - 1) {
      currentIndex++;
      renderQuestion();
    } else {
      finishDuel();
    }
  });

  /* ---------------- Итог ---------------- */
  function finishDuel() {
    let outcome;
    if (playerScore > botScore) outcome = 'win';
    else if (playerScore < botScore) outcome = 'loss';
    else outcome = 'draw';

    if (outcome === 'win') LexPrepProgress.addCoins(duelWager * 2);
    else if (outcome === 'draw') LexPrepProgress.addCoins(duelWager);

    const stats = LexPrepProgress.recordDuelResult(outcome);
    const coinsDelta = outcome === 'win' ? duelWager : outcome === 'loss' ? -duelWager : 0;
    const subtitles = {
      win: 'Соперник повержен — так держать!',
      loss: 'В этот раз бот оказался сильнее. Реванш?',
      draw: 'Силы равны — ставка вернулась на баланс.'
    };

    const resultEl = document.getElementById('duelResult');
    resultEl.innerHTML = Arena.resultHtml({
      outcome,
      subtitle: subtitles[outcome],
      left: mePlayer,
      right: botPlayer,
      leftScore: playerScore,
      rightScore: botScore,
      rewards: [
        { icon: '🪙', label: 'монет', value: coinsDelta, tone: coinsDelta > 0 ? 'up' : coinsDelta < 0 ? 'down' : 'neutral' },
        { icon: '📈', label: `рейтинг · ${stats.rating}`, value: RATING_DELTA[outcome], tone: RATING_DELTA[outcome] >= 0 ? 'up' : 'down' }
      ]
    });

    const breakdownEl = document.getElementById('duelBreakdown');
    breakdownEl.innerHTML = roundLog.map((r, i) => `
      <div class="arena-round-row">
        <span class="arena-round-row__num">${i + 1}</span>
        <span class="arena-round-row__topic">${esc(r.item.topicTitle)}</span>
        <span class="arena-round-row__mark ${r.playerCorrect ? 'is-ok' : 'is-bad'}" title="Ты">${r.playerCorrect ? '✓' : '✗'}</span>
        <span class="arena-round-row__mark ${r.botCorrect ? 'is-ok' : 'is-bad'}" title="${esc(botPlayer.name)}">${r.botCorrect ? '✓' : '✗'}</span>
      </div>
    `).join('');

    showView('results');
    Arena.playResult(resultEl, outcome);
    if (window.LexPrepMotion) LexPrepMotion.stagger(breakdownEl, '.arena-round-row', 500);
    renderProfile();
    renderBalance();
  }

  document.getElementById('duelPlayAgainBtn').addEventListener('click', () => {
    renderBalance();
    renderProfile();
    renderWagerHint();
    errorEl.hidden = true;
    showView('setup');
  });

  showView('setup');
});
