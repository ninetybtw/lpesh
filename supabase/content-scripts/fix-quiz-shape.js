// LexPrep — разовый фикс: import-criminal-procedure.js и
// import-international-law.js записали topic_quiz.questions в форме
// { options: ["текст", ...], correct: [индекс, ...] } — но
// content-loader.js (lexprepConvertQuiz) ожидает ту же форму, что и
// civil/constitutional/criminal-law: { options: [{id,text}, ...],
// correct: [id, ...] }. Из-за несовпадения формы все вопросы этих двух
// дисциплин молча отбрасывались на фронтенде (correct.length === 0
// после недостижимого поиска по o.id), и тесты выглядели пустыми, хотя
// в базе данные были. Приводим обе дисциплины к общему формату.
//
// Использование:
//   node fix-quiz-shape.js

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_IDS = ['criminal-procedure', 'international-law'];
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function needsFix(q) {
  return Array.isArray(q.options) && q.options.length > 0 && typeof q.options[0] !== 'object';
}

function fixQuestion(q, qIndex) {
  if (!needsFix(q)) return q;
  const options = q.options.map((text, i) => ({ id: LETTERS[i] || String(i), text }));
  const correct = q.correct.map(i => LETTERS[i] || String(i));
  return { ...q, options, correct };
}

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }

  const { data: topics, error: topicsErr } = await client
    .from('topics')
    .select('id')
    .in('discipline_id', DISCIPLINE_IDS);
  if (topicsErr) { console.error(topicsErr.message); process.exit(1); }

  const topicIds = topics.map(t => t.id);
  const { data: quizRows, error: quizErr } = await client
    .from('topic_quiz')
    .select('topic_id, questions')
    .in('topic_id', topicIds);
  if (quizErr) { console.error(quizErr.message); process.exit(1); }

  let fixedTopics = 0;
  let fixedQuestions = 0;

  for (const row of quizRows) {
    const anyNeedsFix = row.questions.some(needsFix);
    if (!anyNeedsFix) continue;

    const newQuestions = row.questions.map((q, i) => {
      if (needsFix(q)) fixedQuestions++;
      return fixQuestion(q, i);
    });

    const { error: updErr } = await client
      .from('topic_quiz')
      .update({ questions: newQuestions })
      .eq('topic_id', row.topic_id);
    if (updErr) { console.error(`update failed for ${row.topic_id}:`, updErr.message); process.exit(1); }
    fixedTopics++;
  }

  console.log(`Готово: обновлено ${fixedTopics} тем, ${fixedQuestions} вопросов приведено к правильной форме.`);
})();
