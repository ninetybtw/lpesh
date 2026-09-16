/* ==========================================================================
CONTENT-LOADER.JS — подгружает реальный контент тем (Supabase
public.disciplines/public.topics/public.topic_quiz/public.topic_flashcards/
public.topic_practice, см. supabase/content.sql и supabase/quiz-content.sql)
и подменяет им демо-данные в LEXPREP_DATA для тех дисциплин, для которых в
базе есть темы. Часть дисциплин (например, «Гражданское право») целиком
живёт в базе и заменяет demo-запись; часть дисциплин существует ТОЛЬКО в
базе (их вообще нет в data.js) и просто добавляется в LEXPREP_DATA.

Тема хранится в базе как markdown (body_markdown) и рендерится в HTML через
vendor/marked.min.js. Тесты/карточки/практика хранятся "как прислали"
(сырой JSON с id вариантов, позициями Пленумов и т.п.) и конвертируются
здесь же под форму, которую уже понимает фронтенд:
  - test — вопросы в единой форме, question.correct ВСЕГДА массив индексов
    правильных вариантов (для одиночного выбора — длины 1). Радио/чекбоксы
    и порядок сравнения ответа везде (тренажёр, экзамен, дуэли, турниры,
    пользовательские тесты) решаются по correct.length, отдельного поля
    типа вопроса не нужно;
  - cards — как и раньше, {front, back};
  - practice — готовый HTML (позиции Пленумов + судебная практика).

Экспортирует window.LexPrepContentReady — промис, который резолвится, когда
LEXPREP_DATA готов к рендеру. Страницы, которые используют LEXPREP_DATA при
инициализации (app.js, exam.js, duel.js, duel-pvp.js, tournaments.js,
create-test.js), дожидаются этот промис перед стартом.

Раньше этот промис всегда ждал сеть (до 23 секунд на медленном интернете —
именно из-за этого на слабом вайфае страница часами не показывала темы: вся
инициализация страницы стояла за одним await). Теперь контент из последней
успешной загрузки кэшируется в localStorage: если кэш есть, он применяется
СИНХРОННО прямо здесь, промис резолвится почти мгновенно, а свежую версию
подтягиваем в фоне (не блокируя страницу) для следующего визита. Ждать сеть
целиком приходится только при первом визите с этого браузера, когда кэша ещё
нет вообще — в этом случае показываем оверлей с пояснением, чтобы страница
не выглядела зависшей.
========================================================================== */

const LEXPREP_CONTENT_CACHE_KEY = 'lexprep_content_cache_v1';

function lexprepEscapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Единая форма вопроса для всего фронтенда: correct — всегда массив
// индексов (для одиночного выбора длиной 1). Радио/чекбоксы и проверка
// ответа везде решаются по q.correct.length, а не по отдельному полю
// типа — так один и тот же вопрос одинаково понимают тренажёр, экзамен,
// дуэли и турниры.
function lexprepConvertQuiz(rawQuestions) {
  const result = [];
  (rawQuestions || []).forEach(q => {
    const optionTexts = (q.options || []).map(o => o.text);
    const correct = (q.correct || [])
      .map(id => (q.options || []).findIndex(o => o.id === id))
      .filter(i => i >= 0);
    if (correct.length) {
      result.push({ question: q.question, options: optionTexts, correct, explanation: q.explanation });
    }
  });
  return result;
}

function lexprepConvertFlashcards(rawCards) {
  return (rawCards || []).map(c => ({ front: c.front, back: c.back }));
}

function lexprepRenderPractice(acts, caseLaw) {
  const actsHtml = (acts || []).length ? `
    <h2>Позиции Пленумов и разъяснений</h2>
    ${acts.map(act => `
      <div class="practice-act">
        <div class="practice-act__name">${lexprepEscapeHtml(act.name)}</div>
        ${(act.positions || []).map(p => `
          <div class="practice-position">
            <div class="practice-position__point">${lexprepEscapeHtml(p.point)}</div>
            <p class="practice-position__text">${lexprepEscapeHtml(p.position)}</p>
            <p class="practice-position__why"><strong>Почему важно:</strong> ${lexprepEscapeHtml(p.why_important)}</p>
          </div>
        `).join('')}
      </div>
    `).join('')}
  ` : '';

  const caseLawHtml = (caseLaw || []).length ? `
    <h2>Дела и обзоры судебной практики</h2>
    ${caseLaw.map(c => `
      <div class="practice-case">
        <div class="practice-case__source">${lexprepEscapeHtml(c.source)}</div>
        <p><strong>Обстоятельства:</strong> ${lexprepEscapeHtml(c.facts)}</p>
        <p><strong>Вывод суда:</strong> ${lexprepEscapeHtml(c.conclusion)}</p>
      </div>
    `).join('')}
  ` : '';

  if (!actsHtml && !caseLawHtml) return null;
  return `<div class="theory">${actsHtml}${caseLawHtml}</div>`;
}

// Подстраховка: если запрос к Supabase зависнет (не отклонится и не
// выполнится — на практике видели такое с supabase-js в некоторых
// окружениях), страница не должна виснуть с пустыми дисциплинами
// навсегда. Через 8 секунд просто сдаёмся и остаёмся на demo-контенте.
function lexprepWithTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('lexprep_content_timeout')), ms))
  ]);
}

function lexprepFetchAll(client) {
  return Promise.all([
    client.from('disciplines').select('*').order('sort_order'),
    client.from('topics').select('*').order('sort_order'),
    client.from('topic_quiz').select('*'),
    client.from('topic_flashcards').select('*'),
    client.from('topic_practice').select('*')
  ]);
}

function lexprepBuildDisciplinesData(disciplines, topics, quizByTopic, cardsByTopic, practiceByTopic) {
  const byDiscipline = {};
  topics.forEach(t => {
    (byDiscipline[t.discipline_id] = byDiscipline[t.discipline_id] || []).push(t);
  });

  return disciplines.map(d => {
    const dbTopics = (byDiscipline[d.id] || []).map(t => {
      const practiceRow = practiceByTopic[t.id];
      const practiceHtml = practiceRow ? lexprepRenderPractice(practiceRow.acts, practiceRow.case_law) : null;
      return {
        id: t.id,
        title: t.title,
        description: t.section || '',
        theory: `<div class="theory">${marked.parse(t.body_markdown || '')}</div>`,
        test: lexprepConvertQuiz(quizByTopic[t.id]),
        cards: lexprepConvertFlashcards(cardsByTopic[t.id]),
        practice: practiceHtml
      };
    });
    return { id: d.id, title: d.title, topics: dbTopics };
  }).filter(d => d.topics.length);
}

function lexprepApplyDisciplinesData(disciplinesData) {
  disciplinesData.forEach(d => {
    const existing = LEXPREP_DATA.find(x => x.id === d.id);
    if (existing) {
      existing.title = d.title;
      existing.topics = d.topics;
    } else {
      LEXPREP_DATA.push({ id: d.id, title: d.title, topics: d.topics });
    }
  });
}

function lexprepLoadContentCache() {
  try {
    const raw = localStorage.getItem(LEXPREP_CONTENT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.disciplines) && parsed.disciplines.length ? parsed : null;
  } catch (e) {
    return null;
  }
}

function lexprepSaveContentCache(disciplinesData) {
  try {
    localStorage.setItem(LEXPREP_CONTENT_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), disciplines: disciplinesData }));
  } catch (e) {
    // localStorage переполнен или недоступен (приватный режим) — не
    // критично, просто не кэшируем, в следующий раз опять подождём сеть.
  }
}

// Оверлей на случай, когда кэша ещё нет и реально приходится ждать сеть —
// чтобы страница не выглядела зависшей/сломанной на медленном интернете.
function lexprepShowLoadingOverlay() {
  if (document.getElementById('lexprepContentOverlay')) return () => {};
  const style = document.createElement('style');
  style.id = 'lexprepContentOverlayStyle';
  style.textContent = `
    #lexprepContentOverlay { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 14px; background: rgba(10, 12, 20, 0.94); color: #fff; text-align: center; padding: 24px; }
    #lexprepContentOverlay .lexprep-spinner { width: 40px; height: 40px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.25); border-top-color: #fff; animation: lexprepSpin 0.8s linear infinite; }
    #lexprepContentOverlay p { margin: 0; max-width: 360px; font-size: 14px; line-height: 1.5; opacity: 0.85; }
    #lexprepContentOverlay p.lexprep-overlay-title { font-size: 16px; font-weight: 700; opacity: 1; }
    @keyframes lexprepSpin { to { transform: rotate(360deg); } }
  `;
  const overlay = document.createElement('div');
  overlay.id = 'lexprepContentOverlay';
  overlay.innerHTML = `
    <div class="lexprep-spinner"></div>
    <p class="lexprep-overlay-title">Загружаем базу тем…</p>
    <p>На медленном интернете это может занять до 20 секунд — это только один раз, дальше сайт будет открываться намного быстрее.</p>
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);
  return () => { overlay.remove(); style.remove(); };
}

// Собственно загрузка/обновление из Supabase. Если передан cache — не
// блокирует страницу (кэш уже применён вызывающим кодом), просто тихо
// обновляет LEXPREP_DATA и кэш в фоне на будущее. Если cache нет — это и
// есть тот самый await, который ждут страницы через LexPrepContentReady.
async function lexprepRefreshContent(hadCache) {
  const hideOverlay = hadCache ? null : lexprepShowLoadingOverlay();
  try {
    if (typeof LEXPREP_DATA === 'undefined' || typeof LexPrepApi === 'undefined' || typeof marked === 'undefined') {
      console.error('LexPrep: content-loader запустился раньше нужных скриптов, остаёмся на ' + (hadCache ? 'кэшированном' : 'demo') + ' контенте', {
        LEXPREP_DATA: typeof LEXPREP_DATA, LexPrepApi: typeof LexPrepApi, marked: typeof marked
      });
      return;
    }

    const client = LexPrepApi.getClient();
    let results;
    try {
      results = await lexprepWithTimeout(lexprepFetchAll(client), 8000);
    } catch (e) {
      // Первая попытка не успела за 8с (медленная сеть) — пробуем ещё раз
      // с более щедрым таймаутом, прежде чем сдаться.
      console.warn('LexPrep: первая загрузка контента не удалась, повторяю попытку', e);
      results = await lexprepWithTimeout(lexprepFetchAll(client), 15000);
    }
    const [
      { data: disciplines, error: discErr },
      { data: topics, error: topicErr },
      { data: quizzes, error: quizErr },
      { data: flashcardRows, error: cardsErr },
      { data: practiceRows, error: practiceErr }
    ] = results;
    if (discErr || topicErr || !disciplines || !topics) {
      console.error('LexPrep: не удалось загрузить контент из Supabase, остаёмся на ' + (hadCache ? 'кэшированном' : 'demo') + ' контенте', discErr || topicErr);
      return;
    }

    const quizByTopic = {};
    (quizzes || []).forEach(q => { quizByTopic[q.topic_id] = q.questions; });
    const cardsByTopic = {};
    (flashcardRows || []).forEach(c => { cardsByTopic[c.topic_id] = c.cards; });
    const practiceByTopic = {};
    (practiceRows || []).forEach(p => { practiceByTopic[p.topic_id] = p; });

    if (quizErr || cardsErr || practiceErr) {
      // Конспект важнее — если тесты/карточки/практика не загрузились,
      // всё равно показываем хотя бы теорию, а не откатываемся к demo.
    }

    const disciplinesData = lexprepBuildDisciplinesData(disciplines, topics, quizByTopic, cardsByTopic, practiceByTopic);
    lexprepApplyDisciplinesData(disciplinesData);
    lexprepSaveContentCache(disciplinesData);
  } catch (e) {
    console.error('LexPrep: контент из Supabase не загрузился, остаёмся на ' + (hadCache ? 'кэшированном' : 'demo') + ' контенте', e);
  } finally {
    if (hideOverlay) hideOverlay();
  }
}

window.LexPrepContentReady = (async function loadDbContent() {
  const cache = lexprepLoadContentCache();
  if (cache) {
    lexprepApplyDisciplinesData(cache.disciplines);
    // Кэш уже на месте — страницу больше не задерживаем, обновление сети
    // идёт в фоне и никого не блокирует.
    lexprepRefreshContent(true);
    return;
  }

  // Кэша ещё нет (первый визит с этого браузера) — тут действительно
  // приходится ждать сеть, показываем оверлей вместо тихого зависания.
  await lexprepRefreshContent(false);
})();
