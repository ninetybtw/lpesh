/* ==========================================================================
CONTENT-LOADER.JS — подгружает реальный контент тем (Supabase
public.disciplines/public.topics, см. supabase/content.sql) и подменяет
им демо-данные в LEXPREP_DATA для тех дисциплин, для которых в базе есть
темы (сейчас — «civil», Гражданское право: 26 тем из официального
конспекта). Остальные дисциплины пока остаются как в data.js — демо-контент,
в базу ещё не перенесён.

Тема хранится в базе как markdown (body_markdown) и рендерится в HTML
через vendor/marked.min.js — так конспект можно грузить почти как есть,
без ручной вёрстки каждой темы. Тестов/карточек в базе пока нет — темы
из базы приходят с пустыми test/cards (заполнятся отдельным шагом позже).

Экспортирует window.LexPrepContentReady — промис, который резолвится,
когда LEXPREP_DATA обновлён (или сразу, если подгрузка не удалась — тогда
просто остаётся demo-контент, деградация плавная, сайт не должен падать
из-за недоступности Supabase). Страницы, которые используют LEXPREP_DATA
при инициализации (app.js, exam.js, duel.js, duel-pvp.js, tournaments.js,
create-test.js), дожидаются этот промис перед стартом.
========================================================================== */

window.LexPrepContentReady = (async function loadDbContent() {
  try {
    if (typeof LEXPREP_DATA === 'undefined' || typeof LexPrepApi === 'undefined' || typeof marked === 'undefined') return;

    const client = LexPrepApi.getClient();
    const [{ data: disciplines, error: discErr }, { data: topics, error: topicErr }] = await Promise.all([
      client.from('disciplines').select('*').order('sort_order'),
      client.from('topics').select('*').order('sort_order')
    ]);
    if (discErr || topicErr || !disciplines || !topics) return;

    const byDiscipline = {};
    topics.forEach(t => {
      (byDiscipline[t.discipline_id] = byDiscipline[t.discipline_id] || []).push(t);
    });

    disciplines.forEach(d => {
      const dbTopics = (byDiscipline[d.id] || []).map(t => ({
        id: t.id,
        title: t.title,
        description: t.section || '',
        theory: marked.parse(t.body_markdown || ''),
        test: [],
        cards: []
      }));
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
