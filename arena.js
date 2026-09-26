/* ==========================================================================
ARENA.JS — общий «игровой» интерфейс для дуэлей и турниров (duel.js,
duel-pvp.js, tournaments.js): карточки игроков, заставка «VS» с
отсчётом, табло боя (счёт, индикаторы раундов, таймер, статус соперника),
эффекты попаданий, подсветка ответов и баннер итога. Логики игры здесь
нет — только отображение; стили в styles/arena.css.
========================================================================== */

const Arena = (function () {
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) { /* не поддерживается — не страшно */ }
  }

  // Игрок для экранов арены: { name, avatar, emoji, meta, rankIcon, tone }.
  // tone: 'blue' (ты) или 'red' (соперник) — цвет стороны.
  function levelInfo(xp) {
    if (typeof LexPrepProgress === 'undefined' || typeof xp !== 'number') return null;
    return LexPrepProgress.getLevelInfo(xp);
  }

  function me(user, extraMeta) {
    const g = typeof LexPrepProgress !== 'undefined' && LexPrepProgress.getGamification ? LexPrepProgress.getGamification() : null;
    return {
      name: (user && user.name ? user.name : 'Ты').trim(),
      avatar: user && user.avatar,
      meta: extraMeta || (g ? `Ур. ${g.level} · ${g.rankName}` : ''),
      rankIcon: g ? g.rankIcon : null,
      tone: 'blue'
    };
  }

  function fromProfile(profile, fallbackName, extraMeta) {
    const info = profile ? levelInfo(profile.xp) : null;
    return {
      name: (profile && profile.name) || fallbackName || 'Соперник',
      avatar: profile && profile.avatar,
      meta: extraMeta || (info ? `Ур. ${info.level} · ${info.rankName}` : ''),
      rankIcon: info ? info.rankIcon : null,
      tone: 'red'
    };
  }

  function initial(name) {
    return esc((name || '?').trim().charAt(0).toUpperCase());
  }

  function avatarHtml(p, className) {
    const cls = `arena-avatar arena-avatar--${p.tone || 'blue'} ${className || ''}`;
    if (p.emoji) return `<span class="${cls} arena-avatar--emoji">${p.emoji}</span>`;
    if (p.avatar) return `<span class="${cls}" style="background-image:url(${esc(p.avatar)})"></span>`;
    return `<span class="${cls}">${initial(p.name)}</span>`;
  }

  function rankBadge(p) {
    return p.rankIcon ? `<img class="arena-rank" src="assets/badges/${esc(p.rankIcon)}" alt="" />` : '';
  }

  // Карточка игрока для экранов «VS» и готовности.
  function fighterHtml(p, extraClass) {
    return `
      <div class="arena-fighter arena-fighter--${p.tone || 'blue'} ${extraClass || ''}">
        <div class="arena-fighter__avatar-wrap">
          ${avatarHtml(p, 'arena-avatar--xl')}
          ${rankBadge(p)}
        </div>
        <div class="arena-fighter__name">${esc(p.name)}</div>
        ${p.meta ? `<div class="arena-fighter__meta">${esc(p.meta)}</div>` : ''}
      </div>`;
  }

  /* ---------------- Заставка «VS» перед боем ---------------- */
  function vsIntro({ left, right, title, subtitle, countdown }) {
    if (reduced()) return Promise.resolve();
    const overlay = document.createElement('div');
    overlay.className = 'vs-intro';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="vs-intro__bg vs-intro__bg--left"></div>
      <div class="vs-intro__bg vs-intro__bg--right"></div>
      <div class="vs-intro__title">${esc(title || 'Дуэль')}${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</div>
      <div class="vs-intro__row">
        ${fighterHtml(left, 'vs-intro__left')}
        <div class="vs-intro__vs"><span>VS</span></div>
        ${fighterHtml(right, 'vs-intro__right')}
      </div>
      <div class="vs-intro__count" data-count></div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('vs-intro-open');
    const countEl = overlay.querySelector('[data-count]');

    return (async () => {
      await wait(1500);
      if (countdown !== false) {
        for (const n of ['3', '2', '1']) {
          countEl.textContent = n;
          countEl.classList.remove('is-tick');
          void countEl.offsetWidth;
          countEl.classList.add('is-tick');
          await wait(560);
        }
      }
      countEl.textContent = 'В БОЙ!';
      countEl.classList.remove('is-tick');
      void countEl.offsetWidth;
      countEl.classList.add('is-tick', 'is-go');
      vibrate(40);
      await wait(520);
      overlay.classList.add('is-leaving');
      document.body.classList.remove('vs-intro-open');
      await wait(320);
      overlay.remove();
    })();
  }

  // Короткая вспышка по центру экрана («В бой!», «Раунд 2») — не мешает
  // кликам и не задерживает игру.
  function flash(text, tone) {
    if (reduced()) return;
    const el = document.createElement('div');
    el.className = `arena-flash arena-flash--${tone || 'go'}`;
    el.textContent = text;
    el.addEventListener('animationend', () => el.remove());
    document.body.appendChild(el);
  }

  /* ---------------- Табло боя ---------------- */
  // Возвращает контроллер: счёт, индикаторы по вопросам, раунд, таймер,
  // статус и эффекты попаданий.
  function buildHud(container, { left, right, total, timer, roundLabel }) {
    const pips = (side) => Array.from({ length: total }, (_, i) => `<span class="arena-pip" data-pip="${side}-${i}"></span>`).join('');
    container.innerHTML = `
      <div class="arena-hud ${timer ? 'arena-hud--timer' : ''}">
        <div class="arena-hud__side arena-hud__side--left" data-side="left">
          <div class="arena-hud__avatar-wrap">${avatarHtml(left, 'arena-avatar--md')}</div>
          <div class="arena-hud__info">
            <span class="arena-hud__name">${esc(left.name)}</span>
            <span class="arena-hud__status" data-status="left"></span>
          </div>
          <span class="arena-hud__score" data-score="left">0</span>
        </div>
        <div class="arena-hud__center">
          <span class="arena-hud__round">${esc(roundLabel || 'Раунд')} <b data-round>1</b>/${total}</span>
          ${timer ? `
            <div class="arena-timer" data-timer>
              <svg viewBox="0 0 44 44" aria-hidden="true">
                <circle class="arena-timer__track" cx="22" cy="22" r="19" />
                <circle class="arena-timer__fill" cx="22" cy="22" r="19" pathLength="100" data-timer-fill />
              </svg>
              <span class="arena-timer__num" data-timer-num></span>
            </div>` : '<span class="arena-hud__vs">VS</span>'}
        </div>
        <div class="arena-hud__side arena-hud__side--right" data-side="right">
          <span class="arena-hud__score" data-score="right">${right.hiddenScore ? '?' : '0'}</span>
          <div class="arena-hud__info">
            <span class="arena-hud__name">${esc(right.name)}</span>
            <span class="arena-hud__status" data-status="right"></span>
          </div>
          <div class="arena-hud__avatar-wrap">${avatarHtml(right, 'arena-avatar--md')}</div>
        </div>
        <div class="arena-hud__pips arena-hud__pips--left">${pips('left')}</div>
        <div class="arena-hud__pips arena-hud__pips--right">${pips('right')}</div>
      </div>
    `;
    const hud = container.querySelector('.arena-hud');
    const q = (sel) => hud.querySelector(sel);

    function restart(el, cls) {
      if (!el) return;
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }

    const api = {
      el: hud,
      setScore(side, value) {
        const el = q(`[data-score="${side}"]`);
        if (!el || el.textContent === String(value)) return;
        el.textContent = value;
        restart(el, 'is-bump');
      },
      setRound(index) {
        const el = q('[data-round]');
        if (el) el.textContent = index + 1;
        hud.querySelectorAll('.arena-pip.is-current').forEach(p => p.classList.remove('is-current'));
        ['left', 'right'].forEach(side => {
          const pip = q(`[data-pip="${side}-${index}"]`);
          if (pip && !pip.dataset.state) pip.classList.add('is-current');
        });
      },
      // state: 'ok' | 'bad' | 'done' (ответил, результат скрыт) | 'miss'
      pip(side, index, state) {
        const pip = q(`[data-pip="${side}-${index}"]`);
        if (!pip) return;
        pip.dataset.state = state;
        pip.classList.remove('is-current');
        restart(pip, 'is-set');
      },
      status(side, text, tone) {
        const el = q(`[data-status="${side}"]`);
        if (!el) return;
        el.textContent = text || '';
        el.dataset.tone = tone || '';
      },
      setTimer(secondsLeft, totalSeconds) {
        const fill = q('[data-timer-fill]');
        const num = q('[data-timer-num]');
        const wrap = q('[data-timer]');
        if (!fill || !num) return;
        const ratio = totalSeconds ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0;
        fill.style.strokeDashoffset = String(100 - ratio * 100);
        num.textContent = Math.ceil(secondsLeft);
        wrap.classList.toggle('is-low', secondsLeft <= 5);
      },
      // Удар: атакующая сторона делает выпад, по другой летит «снаряд».
      hit(attacker) {
        const target = attacker === 'left' ? 'right' : 'left';
        const from = q(`[data-side="${attacker}"] .arena-avatar`);
        const to = q(`[data-side="${target}"] .arena-avatar`);
        restart(q(`[data-side="${attacker}"]`), 'is-attack');
        if (reduced() || !from || !to) return;
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const bolt = document.createElement('span');
        bolt.className = `arena-bolt arena-bolt--${attacker}`;
        bolt.style.left = `${a.left + a.width / 2}px`;
        bolt.style.top = `${a.top + a.height / 2}px`;
        bolt.style.setProperty('--dx', `${b.left - a.left}px`);
        bolt.style.setProperty('--dy', `${b.top - a.top}px`);
        document.body.appendChild(bolt);
        bolt.addEventListener('animationend', () => {
          bolt.remove();
          restart(q(`[data-side="${target}"]`), 'is-hit');
        });
      },
      miss(side) {
        restart(q(`[data-side="${side}"]`), 'is-miss');
      },
      // Всплывающий текст над аватаром стороны: «+1», «🔥 ×3», «Мимо».
      pop(side, text, tone) {
        if (reduced()) return;
        const anchor = q(`[data-side="${side}"] .arena-avatar`);
        if (!anchor) return;
        const r = anchor.getBoundingClientRect();
        const el = document.createElement('span');
        el.className = `arena-pop arena-pop--${tone || 'ok'}`;
        el.textContent = text;
        el.style.left = `${r.left + r.width / 2}px`;
        el.style.top = `${r.top - 6}px`;
        el.addEventListener('animationend', () => el.remove());
        document.body.appendChild(el);
      }
    };
    return api;
  }

  /* ---------------- Подсветка ответов после раунда ---------------- */
  function revealAnswers(questionBox, correct, chosen) {
    questionBox.querySelectorAll('.answer').forEach(label => {
      const input = label.querySelector('input');
      if (!input) return;
      const value = Number(input.value);
      input.disabled = true;
      label.classList.toggle('is-correct-option', correct.includes(value));
      label.classList.toggle('is-wrong-option', chosen.includes(value) && !correct.includes(value));
    });
  }

  // Карточка вопроса: номер раунда, тема, вопрос и варианты.
  function questionHtml(item, index, name) {
    const isMulti = item.question.correct.length > 1;
    return `
      <div class="arena-question__head">
        <span class="arena-question__num">Вопрос ${index + 1}</span>
        <span class="arena-question__topic">${esc(item.topicTitle)}</span>
      </div>
      <h4>${esc(item.question.question)}</h4>
      ${isMulti ? '<p class="question--multi__hint">Выбери все подходящие варианты</p>' : ''}
      <div class="answers">
        ${item.question.options.map((option, i) => `
          <label class="answer">
            <input type="${isMulti ? 'checkbox' : 'radio'}" name="${name}" value="${i}">
            <span>${esc(option)}</span>
          </label>
        `).join('')}
      </div>
    `;
  }

  function animateIn(el, cls) {
    if (!el) return;
    el.classList.remove(cls || 'is-entering');
    void el.offsetWidth;
    el.classList.add(cls || 'is-entering');
  }

  /* ---------------- Баннер итога ---------------- */
  const OUTCOME = {
    win: { icon: '🏆', title: 'Победа!', tone: 'win' },
    loss: { icon: '💔', title: 'Поражение', tone: 'loss' },
    draw: { icon: '🤝', title: 'Ничья', tone: 'draw' },
    champion: { icon: '👑', title: 'Чемпион!', tone: 'win' },
    wait: { icon: '⏳', title: 'Ждём соперника', tone: 'draw' },
    out: { icon: '🛡️', title: 'Выбывание', tone: 'loss' }
  };

  // rewards: [{ icon, label, value, tone }]; value — число (набегает) или строка.
  function resultHtml({ outcome, title, subtitle, left, right, leftScore, rightScore, rewards }) {
    const o = OUTCOME[outcome] || OUTCOME.draw;
    return `
      <div class="arena-result arena-result--${o.tone}">
        <div class="arena-result__burst" aria-hidden="true"></div>
        <div class="arena-result__icon">${o.icon}</div>
        <h1 class="arena-result__title">${esc(title || o.title)}</h1>
        ${subtitle ? `<p class="arena-result__subtitle">${esc(subtitle)}</p>` : ''}
        ${left && right ? `
          <div class="arena-result__score">
            <div class="arena-result__side">${avatarHtml(left, 'arena-avatar--lg')}<span class="arena-result__name">${esc(left.name)}</span></div>
            <div class="arena-result__nums"><b>${leftScore == null ? '–' : leftScore}</b><i>:</i><b>${rightScore == null ? '?' : rightScore}</b></div>
            <div class="arena-result__side">${avatarHtml(right, 'arena-avatar--lg')}<span class="arena-result__name">${esc(right.name)}</span></div>
          </div>` : ''}
        ${rewards && rewards.length ? `
          <div class="arena-result__rewards">
            ${rewards.map(r => `
              <div class="arena-reward arena-reward--${r.tone || 'neutral'}">
                <span class="arena-reward__icon">${r.icon}</span>
                <span class="arena-reward__value" ${typeof r.value === 'number' ? `data-count-to="${r.value}"` : ''}>${typeof r.value === 'number' ? (r.value > 0 ? '+0' : '0') : esc(r.value)}</span>
                <span class="arena-reward__label">${esc(r.label)}</span>
              </div>`).join('')}
          </div>` : ''}
      </div>
    `;
  }

  // После вставки resultHtml: набегающие числа наград и конфетти за победу.
  function playResult(container, outcome) {
    container.querySelectorAll('[data-count-to]').forEach(el => {
      const target = Number(el.dataset.countTo);
      const sign = target > 0 ? '+' : target < 0 ? '−' : '';
      const abs = Math.abs(target);
      if (reduced()) {
        el.textContent = `${sign}${abs}`;
        return;
      }
      const start = performance.now() + 450;
      const step = (now) => {
        const t = Math.max(0, Math.min(1, (now - start) / 900));
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = `${sign}${Math.round(abs * eased)}`;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    if ((outcome === 'win' || outcome === 'champion') && window.LexPrepMotion) {
      setTimeout(() => LexPrepMotion.confetti(container.querySelector('.arena-result__icon')), 350);
      vibrate([30, 60, 30]);
    }
  }

  // Карточки игроков по id (для соперников в PvP и турнирах). Ошибки сети
  // не ломают экран — просто остаёмся на имени-заглушке.
  async function loadProfiles(ids) {
    const map = new Map();
    if (typeof LexPrepApi === 'undefined' || typeof LexPrepApi.getPublicProfiles !== 'function') return map;
    try {
      const list = await LexPrepApi.getPublicProfiles(ids);
      list.forEach(p => map.set(p.id, p));
    } catch (e) { /* без карточек — не критично */ }
    return map;
  }

  return {
    esc, reduced, wait, vibrate, me, fromProfile, avatarHtml, fighterHtml, rankBadge,
    vsIntro, flash, buildHud, revealAnswers, questionHtml, animateIn,
    resultHtml, playResult, loadProfiles, levelInfo
  };
})();
