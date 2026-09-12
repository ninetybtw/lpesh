// LexPrep — импорт продолжения "Гражданское право" (обязательственное
// право, темы 28-55) в существующую дисциплину discipline_id='civil'
// (темы 1-26 — общая часть, уже в базе; тема 27 в этой поставке
// отсутствует — пропуск в исходнике, не наша ошибка).
//
// Формат исходников — JSON (не markdown с front matter, как в остальных
// импортёрах):
//   json/temaNN_<slug>.json   — конспект: { meta: {title, topic_number},
//                                 content_markdown: "# Тема N. ...\n..." }
//   json/temaNN_testy.json    — тест: { questions: [{ question, options:
//                                 [{id,text}], correct_option_id, explanation }] }
//   json/temaNN_kartochki.json — карточки: { cards: [{front, back}] }
//   json/temaNN_praktika.json — практика (не для всех тем): { content_markdown }
//                                 в свободной форме (не structured acts/case_law
//                                 как в quiz-content.sql) — парсим эвристически:
//                                 первый "## "-раздел = разъяснения Пленумов/
//                                 высших судов (по подряделам "### ", буллеты —
//                                 позиция, "**...важно:**" — почему важно),
//                                 второй "## "-раздел = примеры/казусы (по
//                                 подразделам "### ", "**Источник:**" — источник,
//                                 остальные "**Label:** текст" — эвристически в
//                                 facts (если label содержит "обстоятельств")
//                                 или в conclusion (всё остальное); если в
//                                 разделе вовсе нет "### " подразделов или "**
//                                 Label:**" — раздел/подраздел целиком уходит
//                                 одним пунктом.
//
// Использование:
//   node import-gp-chast2.js <json-dir>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'civil';

const [, , jsonDir] = process.argv;
if (!jsonDir) {
  console.error('Usage: node import-gp-chast2.js <json-dir>');
  process.exit(1);
}

function topicId(n) {
  return `${DISCIPLINE_ID}-${String(n).padStart(2, '0')}`;
}

function stripHeading(md) {
  return md.replace(/^\s*# Тема \d+\.[^\n]*\n/, '').trim();
}

// ---------------- Практика: эвристический парсер свободного markdown ----------------

function splitTopSections(md) {
  // Всё после первого "# " заголовка, разбитое по "## " разделам.
  const body = md.replace(/^#[^\n]*\n/, '');
  const parts = body.split(/^## /m).map(s => s.trim()).filter(Boolean);
  return parts.map(p => {
    const nl = p.indexOf('\n');
    return { heading: (nl === -1 ? p : p.slice(0, nl)).trim(), body: (nl === -1 ? '' : p.slice(nl + 1)).trim() };
  });
}

function splitSubSections(body) {
  if (!/^### /m.test(body)) return null;
  const parts = body.split(/^### /m).map(s => s.trim()).filter(Boolean);
  return parts.map(p => {
    const nl = p.indexOf('\n');
    return { heading: (nl === -1 ? p : p.slice(0, nl)).trim(), body: (nl === -1 ? '' : p.slice(nl + 1)).trim() };
  });
}

// Разбирает тело подраздела на пары "**Label:** текст" (текст — до
// следующей "**Label:**" метки или до конца).
function splitLabeledFields(body) {
  const matches = [...body.matchAll(/\*\*([^*:]+):\*\*\s*([\s\S]*?)(?=\n?\*\*[^*:]+:\*\*|\n---|$)/g)];
  return matches.map(m => ({ label: m[1].trim().toLowerCase(), text: m[2].trim() }));
}

function parseActs(sectionBody, sectionHeading) {
  const subs = splitSubSections(sectionBody);
  if (!subs) {
    return [{ name: sectionHeading, positions: [{ point: '', position: sectionBody.replace(/^---\s*$/m, '').trim(), why_important: '' }] }];
  }
  return subs.map(sub => {
    const whyMatch = sub.body.match(/\*\*[^*:]*важно[^*:]*:\*\*\s*([\s\S]*?)(?=\n?\*\*[^*:]+:\*\*|\n---|$)/i);
    const whyImportant = whyMatch ? whyMatch[1].trim() : '';
    const withoutWhy = whyMatch ? sub.body.slice(0, whyMatch.index).trim() : sub.body.replace(/^---\s*$/m, '').trim();
    const bullets = [...withoutWhy.matchAll(/^-\s*(.+)$/gm)].map(m => m[1].trim());
    const position = bullets.length ? bullets.join('\n') : withoutWhy;
    return { name: sub.heading, positions: [{ point: '', position, why_important: whyImportant }] };
  });
}

function parseCaseLaw(sectionBody) {
  const subs = splitSubSections(sectionBody);
  if (!subs) {
    return [{ source: '', facts: '', conclusion: sectionBody.replace(/^---\s*$/m, '').trim() }];
  }
  return subs.map(sub => {
    const clean = sub.body.replace(/^---\s*$/m, '').trim();
    const fields = splitLabeledFields(clean);
    let source = '';
    const facts = [];
    const conclusion = [];
    fields.forEach(f => {
      if (f.label.includes('источник')) source = f.text;
      else if (f.label.includes('обстоятельств')) facts.push(f.text);
      else if (f.label.includes('вывод')) conclusion.push(f.text);
      else conclusion.push(f.text);
    });
    if (!fields.length) {
      // Совсем без bold-меток (напр. тема 51) — источник берём из заголовка,
      // весь текст — в вывод.
      source = sub.heading;
      conclusion.push(clean);
    } else if (!source) {
      source = sub.heading;
    }
    return { source, facts: facts.join('\n'), conclusion: conclusion.join('\n') };
  });
}

function parsePractice(md) {
  const sections = splitTopSections(md);
  const actsSection = sections[0];
  const caseSection = sections[1];
  const acts = actsSection ? parseActs(actsSection.body, actsSection.heading) : [];
  const caseLaw = caseSection ? parseCaseLaw(caseSection.body) : [];
  return { acts, case_law: caseLaw };
}

// ---------------- Сбор файлов по темам ----------------

const files = fs.readdirSync(jsonDir);
const byTopic = {};
files.forEach(f => {
  let m;
  if ((m = f.match(/^tema(\d+)_testy\.json$/))) {
    (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).testy = f;
  } else if ((m = f.match(/^tema(\d+)_kartochki\.json$/))) {
    (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).kartochki = f;
  } else if ((m = f.match(/^tema(\d+)_praktika\.json$/))) {
    (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).praktika = f;
  } else if ((m = f.match(/^tema(\d+)_(.+)\.json$/)) && m[2] !== 'testy' && m[2] !== 'kartochki' && m[2] !== 'praktika') {
    (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).konspekt = f;
  }
});

const topics = [];
const quizRows = [];
const flashcardRows = [];
const practiceRows = [];

Object.keys(byTopic).sort((a, b) => Number(a) - Number(b)).forEach(nStr => {
  const n = Number(nStr);
  const f = byTopic[n];
  if (!f.konspekt || !f.testy || !f.kartochki) {
    throw new Error(`Тема ${n}: не хватает файлов (${JSON.stringify(f)})`);
  }

  const konspekt = JSON.parse(fs.readFileSync(path.join(jsonDir, f.konspekt), 'utf-8'));
  topics.push({
    id: topicId(n),
    discipline_id: DISCIPLINE_ID,
    topic_number: n,
    title: konspekt.meta.title,
    section: 'Гражданское право',
    body_markdown: stripHeading(konspekt.content_markdown),
    sort_order: n
  });

  const testy = JSON.parse(fs.readFileSync(path.join(jsonDir, f.testy), 'utf-8'));
  const questions = testy.questions.map(q => ({
    question: q.question,
    options: q.options,
    correct: [q.correct_option_id],
    explanation: q.explanation || ''
  }));
  quizRows.push({ topic_id: topicId(n), questions });

  const kartochki = JSON.parse(fs.readFileSync(path.join(jsonDir, f.kartochki), 'utf-8'));
  flashcardRows.push({ topic_id: topicId(n), cards: kartochki.cards.map(c => ({ front: c.front, back: c.back })) });

  if (f.praktika) {
    const praktika = JSON.parse(fs.readFileSync(path.join(jsonDir, f.praktika), 'utf-8'));
    const { acts, case_law } = parsePractice(praktika.content_markdown);
    practiceRows.push({ topic_id: topicId(n), acts, case_law });
  }
});

console.log(`Конспекты: ${topics.length} тем (${topics[0].topic_number}-${topics[topics.length - 1].topic_number}).`);
console.log(`Тесты: ${quizRows.reduce((s, r) => s + r.questions.length, 0)} вопросов по ${quizRows.length} темам.`);
console.log(`Карточки: ${flashcardRows.reduce((s, r) => s + r.cards.length, 0)} штук по ${flashcardRows.length} темам.`);
console.log(`Практика: ${practiceRows.length} тем (позиций: ${practiceRows.reduce((s, r) => s + r.acts.length, 0)}, дел: ${practiceRows.reduce((s, r) => s + r.case_law.length, 0)}).`);

const badQuestions = quizRows.flatMap(r => r.questions.filter(q => !q.correct.length || !q.correct[0] || !q.options.length));
if (badQuestions.length) {
  console.error(`${badQuestions.length} вопросов без правильного ответа/вариантов — прерываю импорт.`);
  console.error(JSON.stringify(badQuestions.slice(0, 3), null, 2));
  process.exit(1);
}
const emptyCaseLaw = practiceRows.flatMap(r => r.case_law.filter(c => !c.facts && !c.conclusion));
if (emptyCaseLaw.length) {
  console.error(`${emptyCaseLaw.length} дел практики без facts/conclusion — прерываю импорт.`);
  console.error(JSON.stringify(emptyCaseLaw.slice(0, 5), null, 2));
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }
  console.log('Logged in as admin.');

  const { error: topicsErr, data: topicsData } = await client.from('topics').upsert(topics).select('id');
  if (topicsErr) { console.error('topics upsert failed:', topicsErr.message); process.exit(1); }
  console.log(`Upserted ${topicsData.length} topics.`);

  const { error: quizErr, data: quizData } = await client.from('topic_quiz').upsert(quizRows).select('topic_id');
  if (quizErr) { console.error('topic_quiz upsert failed:', quizErr.message); process.exit(1); }
  console.log(`Upserted quiz for ${quizData.length} topics.`);

  const { error: cardsErr, data: cardsData } = await client.from('topic_flashcards').upsert(flashcardRows).select('topic_id');
  if (cardsErr) { console.error('topic_flashcards upsert failed:', cardsErr.message); process.exit(1); }
  console.log(`Upserted flashcards for ${cardsData.length} topics.`);

  if (practiceRows.length) {
    const { error: practiceErr, data: practiceData } = await client.from('topic_practice').upsert(practiceRows).select('topic_id');
    if (practiceErr) { console.error('topic_practice upsert failed:', practiceErr.message); process.exit(1); }
    console.log(`Upserted practice for ${practiceData.length} topics.`);
  }

  console.log('Done.');
})();
