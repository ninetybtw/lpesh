/* ==========================================================================
DUEL-ENGINE.JS — общая логика для «Дуэлей» и «Турниров»: подбор вопросов и
симуляция ответа бота-соперника. Реальных соперников тут нет — это честный
демо-режим против бота, до появления бэкенда с настоящими игроками.
========================================================================== */

const DuelEngine = (function () {
  const BOT_NAMES = ['Бот Фемида', 'Бот Кодекс', 'Бот Юстиция', 'Бот Прецедент', 'Бот Норма'];

  const DIFFICULTIES = {
    easy: { key: 'easy', label: 'Лёгкий', accuracy: 0.45 },
    medium: { key: 'medium', label: 'Средний', accuracy: 0.65 },
    hard: { key: 'hard', label: 'Сложный', accuracy: 0.85 }
  };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function shuffle(array) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Часть демо-дисциплин в data.js ещё не перешла на новую форму
  // (question.correct — число, а не массив индексов) — приводим на лету,
  // чтобы дуэли/турниры одинаково работали и со старым, и с новым контентом.
  function normalizeQuestion(q) {
    return Array.isArray(q.correct) ? q : { ...q, correct: [q.correct] };
  }

  function buildPool(allData, disciplineId, topicId) {
    const pool = [];
    allData.forEach(d => {
      if (disciplineId && disciplineId !== 'all' && d.id !== disciplineId) return;
      d.topics.forEach(t => {
        if (topicId && topicId !== 'all' && t.id !== topicId) return;
        t.test.forEach((q, qIndex) => {
          pool.push({ topicId: t.id, topicTitle: t.title, disciplineTitle: d.title, qIndex, question: normalizeQuestion(q) });
        });
      });
    });
    return pool;
  }

  function pickQuestions(allData, count, disciplineId, topicId) {
    const pool = shuffle(buildPool(allData, disciplineId, topicId));
    return pool.slice(0, count);
  }

  function pickBotName() {
    return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  }

  function botAnswerCorrect(difficultyKey) {
    const diff = DIFFICULTIES[difficultyKey] || DIFFICULTIES.medium;
    return Math.random() < diff.accuracy;
  }

  // Вопрос может иметь один или несколько правильных ответов
  // (question.correct — всегда массив индексов). Засчитывается только
  // полное совпадение выбранного набора с правильным.
  function sameAnswerSet(chosen, correct) {
    if (!chosen || !chosen.length || chosen.length !== correct.length) return false;
    const a = [...chosen].sort();
    const b = [...correct].sort();
    return a.every((v, i) => v === b[i]);
  }

  return { DIFFICULTIES, escapeHtml, shuffle, buildPool, pickQuestions, pickBotName, botAnswerCorrect, sameAnswerSet };
})();
