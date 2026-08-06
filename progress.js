/* ==========================================================================
PROGRESS.JS — общее хранилище прогресса поверх localStorage.
Используется app.js (карточки/тесты), exam.js (пробный экзамен) и profile.js
(реальная статистика вместо демо-цифр). Данные по-прежнему живут только в
браузере — настоящая синхронизация появится вместе с бэкендом.

Схема:
{
  cards: { "topicId::cardIndex": { box: 1..5, due: <ms>, reviews: n } },
  tests: { "topicId": [ { date: <ms>, score, total } ] },
  examAttempts: [ { date: <ms>, score, total, topics: ["topicId", ...] } ],
  weak: { "topicId::qIndex": { misses: n, lastMissed: <ms> } }
}
========================================================================== */

const LexPrepProgress = (function () {
  const STORAGE_KEY = 'lexprep_progress';
  const BOX_INTERVAL_DAYS = [0, 0, 1, 3, 7, 14]; // индекс = номер ящика (1..5)
  const DAY_MS = 24 * 60 * 60 * 1000;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return {
        cards: (raw && raw.cards) || {},
        tests: (raw && raw.tests) || {},
        examAttempts: (raw && raw.examAttempts) || [],
        weak: (raw && raw.weak) || {}
      };
    } catch (e) {
      return { cards: {}, tests: {}, examAttempts: [], weak: {} };
    }
  }

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function cardKey(topicId, cardIndex) {
    return `${topicId}::${cardIndex}`;
  }

  function weakKey(topicId, qIndex) {
    return `${topicId}::${qIndex}`;
  }

  function getCardState(topicId, cardIndex) {
    const data = load();
    return data.cards[cardKey(topicId, cardIndex)] || { box: 1, due: 0, reviews: 0 };
  }

  function reviewCard(topicId, cardIndex, correct) {
    const data = load();
    const key = cardKey(topicId, cardIndex);
    const state = data.cards[key] || { box: 1, due: 0, reviews: 0 };
    const nextBox = correct ? Math.min(state.box + 1, 5) : 1;
    data.cards[key] = {
      box: nextBox,
      due: Date.now() + BOX_INTERVAL_DAYS[nextBox] * DAY_MS,
      reviews: state.reviews + 1
    };
    save(data);
    return data.cards[key];
  }

  function getDueCardIndexes(topicId, cards) {
    const data = load();
    const now = Date.now();
    return cards
      .map((_, index) => index)
      .filter(index => {
        const state = data.cards[cardKey(topicId, index)];
        return !state || state.due <= now;
      })
      .sort((a, b) => {
        const boxA = (data.cards[cardKey(topicId, a)] || { box: 1 }).box;
        const boxB = (data.cards[cardKey(topicId, b)] || { box: 1 }).box;
        return boxA - boxB;
      });
  }

  function recordTestAttempt(topicId, score, total, wrongIndexes) {
    const data = load();
    if (!data.tests[topicId]) data.tests[topicId] = [];
    data.tests[topicId].push({ date: Date.now(), score, total });

    const total_ = total;
    for (let i = 0; i < total_; i++) {
      const key = weakKey(topicId, i);
      if (wrongIndexes.includes(i)) {
        const prev = data.weak[key] || { misses: 0, lastMissed: 0 };
        data.weak[key] = { misses: prev.misses + 1, lastMissed: Date.now() };
      } else if (data.weak[key]) {
        delete data.weak[key];
      }
    }
    save(data);
  }

  function recordExamAttempt(score, total, topics, wrongEntries) {
    const data = load();
    data.examAttempts.push({ date: Date.now(), score, total, topics });

    wrongEntries.forEach(({ topicId, qIndex, correct }) => {
      const key = weakKey(topicId, qIndex);
      if (!correct) {
        const prev = data.weak[key] || { misses: 0, lastMissed: 0 };
        data.weak[key] = { misses: prev.misses + 1, lastMissed: Date.now() };
      } else if (data.weak[key]) {
        delete data.weak[key];
      }
    });
    save(data);
  }

  function getWeakQuestions(allData, limit) {
    const data = load();
    const entries = Object.keys(data.weak)
      .map(key => {
        const [topicId, qIndexStr] = key.split('::');
        return { topicId, qIndex: Number(qIndexStr), ...data.weak[key] };
      })
      .sort((a, b) => b.misses - a.misses || b.lastMissed - a.lastMissed);

    const resolved = [];
    for (const entry of entries) {
      const topic = findTopic(allData, entry.topicId);
      const question = topic && topic.test[entry.qIndex];
      if (topic && question) {
        resolved.push({ topicId: entry.topicId, topicTitle: topic.title, qIndex: entry.qIndex, question });
      }
      if (limit && resolved.length >= limit) break;
    }
    return resolved;
  }

  function findTopic(allData, topicId) {
    for (const discipline of allData) {
      const topic = discipline.topics.find(t => t.id === topicId);
      if (topic) return topic;
    }
    return null;
  }

  function getStats(allData) {
    const data = load();
    const touchedTopics = new Set();
    let testsCount = 0;
    let scoreSum = 0;
    let scoreTotal = 0;
    const activityDays = new Set();
    const recent = [];

    Object.keys(data.tests).forEach(topicId => {
      const attempts = data.tests[topicId];
      if (attempts.length) touchedTopics.add(topicId);
      attempts.forEach(a => {
        testsCount++;
        scoreSum += a.score;
        scoreTotal += a.total;
        activityDays.add(new Date(a.date).toDateString());
        const topic = findTopic(allData, topicId);
        recent.push({ date: a.date, title: topic ? topic.title : topicId, score: a.score, total: a.total });
      });
    });

    data.examAttempts.forEach(a => {
      testsCount++;
      scoreSum += a.score;
      scoreTotal += a.total;
      activityDays.add(new Date(a.date).toDateString());
      a.topics.forEach(id => touchedTopics.add(id));
      recent.push({ date: a.date, title: 'Пробный экзамен', score: a.score, total: a.total });
    });

    Object.keys(data.cards).forEach(key => {
      touchedTopics.add(key.split('::')[0]);
    });

    recent.sort((a, b) => b.date - a.date);

    return {
      topicsTouched: touchedTopics.size,
      testsCount,
      avgScorePercent: scoreTotal ? Math.round((scoreSum / scoreTotal) * 100) : null,
      streakDays: computeStreak(activityDays),
      recent: recent.slice(0, 6)
    };
  }

  function computeStreak(daySet) {
    let streak = 0;
    const cursor = new Date();
    while (daySet.has(cursor.toDateString())) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  return {
    getCardState,
    reviewCard,
    getDueCardIndexes,
    recordTestAttempt,
    recordExamAttempt,
    getWeakQuestions,
    getStats,
    findTopic
  };
})();
