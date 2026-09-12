/* ==========================================================================
CONTENT-LOADER.JS — подгружает реальный контент тем (Supabase
public.disciplines/public.topics/public.topic_quiz/public.topic_flashcards/
public.topic_practice, см. supabase/content.sql и supabase/quiz-content.sql)
и подменяет им демо-данные в LEXPREP_DATA для тех дисциплин, для которых в
базе есть темы (сейчас — «civil», Гражданское право). Остальные дисциплины
пока остаются как в data.js — демо-контент, в базу ещё не перенесён.

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

Экспортирует window.LexPrepContentReady — промис, который резолвится,
когда LEXPREP_DATA обновлён (или сразу, если подгрузка не удалась — тогда
просто остаётся demo-контент, деградация плавная, сайт не должен падать
из-за недоступности Supabase). Страницы, которые используют LEXPREP_DATA
при инициализации (app.js, exam.js, duel.js, duel-pvp.js, tournaments.js,
create-test.js), дожидаются этот промис перед стартом.
========================================================================== */

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

window.LexPrepContentReady = (async function loadDbContent() {
  try {
    if (typeof LEXPREP_DATA === 'undefined' || typeof LexPrepApi === 'undefined' || typeof marked === 'undefined') {
      console.error('LexPrep: content-loader запустился раньше нужных скриптов, остаёмся на demo-контенте', {
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
      // с более щедрым таймаутом, прежде чем откатываться на demo-контент.
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
      console.error('LexPrep: не удалось загрузить контент из Supabase, показан demo-контент', discErr || topicErr);
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

    const byDiscipline = {};
    topics.forEach(t => {
      (byDiscipline[t.discipline_id] = byDiscipline[t.discipline_id] || []).push(t);
    });

    disciplines.forEach(d => {
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
      if (!dbTopics.length) return;

      const existing = LEXPREP_DATA.find(x => x.id === d.id);
      if (existing) {
        existing.title = d.title;
        existing.topics = dbTopics;
      } else {
        LEXPREP_DATA.push({ id: d.id, title: d.title, topics: dbTopics });
      }
    });
  } catch (e) {
    console.error('LexPrep: контент из Supabase не загрузился, остаёмся на demo-контенте', e);
  }
})();
