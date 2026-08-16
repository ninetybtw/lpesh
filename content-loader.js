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
  - test — вопросы с одним правильным ответом (question.correct — числовой
    индекс), как и раньше в data.js — используется везде (тренажёр, экзамен,
    дуэли, турниры);
  - testMulti — вопросы с несколькими правильными ответами
    (question.correctIndexes — массив индексов); показываются только в
    собственном тесте темы (app.js), в общий пул экзамена/дуэлей/турниров
    не попадают, т.к. там расчитан только одиночный выбор;
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

function lexprepConvertQuiz(rawQuestions) {
  const single = [];
  const multi = [];
  (rawQuestions || []).forEach(q => {
    const optionTexts = (q.options || []).map(o => o.text);
    if (q.type === 'multiple') {
      const correctIndexes = (q.correct || [])
        .map(id => (q.options || []).findIndex(o => o.id === id))
        .filter(i => i >= 0);
      if (correctIndexes.length) {
        multi.push({ question: q.question, options: optionTexts, correctIndexes, explanation: q.explanation });
      }
    } else {
      const idx = (q.options || []).findIndex(o => o.id === (q.correct || [])[0]);
      if (idx >= 0) {
        single.push({ question: q.question, options: optionTexts, correct: idx, explanation: q.explanation });
      }
    }
  });
  return { single, multi };
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

window.LexPrepContentReady = (async function loadDbContent() {
  try {
    if (typeof LEXPREP_DATA === 'undefined' || typeof LexPrepApi === 'undefined' || typeof marked === 'undefined') return;

    const client = LexPrepApi.getClient();
    const [
      { data: disciplines, error: discErr },
      { data: topics, error: topicErr },
      { data: quizzes, error: quizErr },
      { data: flashcardRows, error: cardsErr },
      { data: practiceRows, error: practiceErr }
    ] = await Promise.all([
      client.from('disciplines').select('*').order('sort_order'),
      client.from('topics').select('*').order('sort_order'),
      client.from('topic_quiz').select('*'),
      client.from('topic_flashcards').select('*'),
      client.from('topic_practice').select('*')
    ]);
    if (discErr || topicErr || !disciplines || !topics) return;

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
        const { single, multi } = lexprepConvertQuiz(quizByTopic[t.id]);
        const practiceRow = practiceByTopic[t.id];
        const practiceHtml = practiceRow ? lexprepRenderPractice(practiceRow.acts, practiceRow.case_law) : null;

        return {
          id: t.id,
          title: t.title,
          description: t.section || '',
          theory: `<div class="theory">${marked.parse(t.body_markdown || '')}</div>`,
          test: single,
          testMulti: multi,
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
    // Молча остаёмся на demo-контенте из data.js.
  }
})();
