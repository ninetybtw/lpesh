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

    let cardsReviewed = 0;
    Object.keys(data.cards).forEach(key => {
      touchedTopics.add(key.split('::')[0]);
      cardsReviewed += data.cards[key].reviews || 0;
    });

    recent.sort((a, b) => b.date - a.date);

    return {
      topicsTouched: touchedTopics.size,
      testsCount,
      avgScorePercent: scoreTotal ? Math.round((scoreSum / scoreTotal) * 100) : null,
      streakDays: computeStreak(activityDays),
      cardsReviewed,
      recent: recent.slice(0, 6)
    };
  }

  function getTopicProgress(topicId, topic) {
    const data = load();
    const parts = [];

    const attempts = data.tests[topicId];
    if (attempts && attempts.length) {
      const bestPercent = Math.max(...attempts.map(a => a.total ? (a.score / a.total) * 100 : 0));
      parts.push(bestPercent);
    }

    const cardsTotal = topic && topic.cards ? topic.cards.length : 0;
    if (cardsTotal) {
      let reviewed = 0;
      for (let i = 0; i < cardsTotal; i++) {
        if (data.cards[cardKey(topicId, i)]) reviewed++;
      }
      parts.push((reviewed / cardsTotal) * 100);
    }

    if (!parts.length) return 0;
    return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }

  function getDisciplineProgress(discipline) {
    if (!discipline.topics.length) return 0;
    const sum = discipline.topics.reduce((acc, t) => acc + getTopicProgress(t.id, t), 0);
    return Math.round(sum / discipline.topics.length);
  }

  /* ---------------- Levels, ranks (Femida tiers), XP ---------------- */

  const RANKS = [
    { key: 'plain', name: 'Новичок', minLevel: 1, maxLevel: 4, icon: 'themis-standard.svg' },
    { key: 'bronze', name: 'Студент', minLevel: 5, maxLevel: 9, icon: 'themis-bronze.svg' },
    { key: 'gold', name: 'Уверенный', minLevel: 10, maxLevel: 14, icon: 'themis-gold.svg' },
    { key: 'platinum', name: 'Практик', minLevel: 15, maxLevel: 19, icon: 'themis-platinum.svg' },
    { key: 'diamond', name: 'Знаток', minLevel: 20, maxLevel: 24, icon: 'themis-diamond.svg' },
    { key: 'ruby', name: 'Эксперт', minLevel: 25, maxLevel: 29, icon: 'themis-ruby.svg' },
    { key: 'sapphire', name: 'Мастер LexPrep', minLevel: 30, maxLevel: Infinity, icon: 'themis-sapphire.svg' }
  ];

  function xpThreshold(level) {
    return Math.round(100 * (level - 1) * level / 2);
  }

  function levelFromXp(xp) {
    let level = 1;
    while (xpThreshold(level + 1) <= xp) level++;
    return level;
  }

  function getRank(level) {
    return RANKS.find(r => level >= r.minLevel && level <= r.maxLevel) || RANKS[RANKS.length - 1];
  }

  function getLevelInfo(xp) {
    const level = levelFromXp(xp);
    const rank = getRank(level);
    return { level, rank: rank.key, rankName: rank.name, rankIcon: rank.icon };
  }

  const COINS_SPENT_KEY = 'lexprep_coins_spent';
  const COINS_BONUS_KEY = 'lexprep_coins_bonus';

  function getCoins() {
    const g = getGamification();
    const earned = Math.floor(g.xp / 4);
    const bonus = Number(localStorage.getItem(COINS_BONUS_KEY) || 0);
    const spent = Number(localStorage.getItem(COINS_SPENT_KEY) || 0);
    return Math.max(0, earned + bonus - spent);
  }

  function spendCoins(amount) {
    if (amount <= 0 || amount > getCoins()) return false;
    const spent = Number(localStorage.getItem(COINS_SPENT_KEY) || 0);
    localStorage.setItem(COINS_SPENT_KEY, String(spent + amount));
    return true;
  }

  function addCoins(amount) {
    if (amount <= 0) return getCoins();
    const bonus = Number(localStorage.getItem(COINS_BONUS_KEY) || 0);
    localStorage.setItem(COINS_BONUS_KEY, String(bonus + amount));
    return getCoins();
  }

  /* ---------------- Duel rating (дуэли и турниры против бота) ---------------- */

  const DUEL_STATS_KEY = 'lexprep_duel_stats';

  function getDuelStats() {
    try {
      const raw = JSON.parse(localStorage.getItem(DUEL_STATS_KEY) || 'null');
      return Object.assign({ wins: 0, losses: 0, draws: 0, rating: 1000 }, raw || {});
    } catch (e) {
      return { wins: 0, losses: 0, draws: 0, rating: 1000 };
    }
  }

  function recordDuelResult(outcome) {
    const stats = getDuelStats();
    if (outcome === 'win') {
      stats.wins++;
      stats.rating += 18;
    } else if (outcome === 'loss') {
      stats.losses++;
      stats.rating = Math.max(0, stats.rating - 12);
    } else {
      stats.draws++;
      stats.rating += 2;
    }
    localStorage.setItem(DUEL_STATS_KEY, JSON.stringify(stats));
    return stats;
  }

  function computeXp(data) {
    let xp = 0;
    Object.keys(data.tests).forEach(topicId => {
      data.tests[topicId].forEach(a => { xp += a.score * 2; });
    });
    data.examAttempts.forEach(a => { xp += a.score * 3; });
    Object.keys(data.cards).forEach(key => { xp += (data.cards[key].reviews || 0) * 2; });
    return xp;
  }

  function getGamification() {
    const data = load();
    const xp = computeXp(data);
    const level = levelFromXp(xp);
    const rank = getRank(level);
    const currentThreshold = xpThreshold(level);
    const nextThreshold = xpThreshold(level + 1);
    const xpIntoLevel = xp - currentThreshold;
    const xpForNextLevel = nextThreshold - currentThreshold;
    const progressPercent = xpForNextLevel ? Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100)) : 100;

    return {
      xp,
      level,
      rank: rank.key,
      rankName: rank.name,
      rankIcon: rank.icon,
      xpIntoLevel,
      xpForNextLevel,
      progressPercent
    };
  }

  /* ---------------- Achievements (8 categories x 5 tiers) ---------------- */

  function findDisciplineIdForTopic(allData, topicId) {
    for (const d of allData) {
      if (d.topics.some(t => t.id === topicId)) return d.id;
    }
    return null;
  }

  function getAchievements(allData) {
    const data = load();
    const baseStats = getStats(allData);

    const touchedTopicIds = new Set();
    Object.keys(data.tests).forEach(topicId => { if (data.tests[topicId].length) touchedTopicIds.add(topicId); });
    data.examAttempts.forEach(a => a.topics.forEach(id => touchedTopicIds.add(id)));
    Object.keys(data.cards).forEach(key => touchedTopicIds.add(key.split('::')[0]));

    const disciplinesTouched = new Set();
    touchedTopicIds.forEach(topicId => {
      const discId = findDisciplineIdForTopic(allData, topicId);
      if (discId) disciplinesTouched.add(discId);
    });

    let testsCount = 0, testScoreSum = 0, testScoreTotal = 0;
    Object.keys(data.tests).forEach(topicId => {
      data.tests[topicId].forEach(a => { testsCount++; testScoreSum += a.score; testScoreTotal += a.total; });
    });
    const testAvgPercent = testScoreTotal ? Math.round((testScoreSum / testScoreTotal) * 100) : 0;

    let examScoreSum = 0, examScoreTotal = 0;
    data.examAttempts.forEach(a => { examScoreSum += a.score; examScoreTotal += a.total; });
    const examAvgPercent = examScoreTotal ? Math.round((examScoreSum / examScoreTotal) * 100) : 0;

    const appVisited = localStorage.getItem('lexprep_visited_app') === '1';
    const articlesPublished = JSON.parse(localStorage.getItem('lexprep_user_articles') || '[]').length;
    const notesData = JSON.parse(localStorage.getItem('lexprep_notes') || '{}');
    const notesCount = Object.keys(notesData).filter(k => notesData[k] && notesData[k].trim().length > 0).length;

    const totalTopics = allData.reduce((sum, d) => sum + d.topics.length, 0);
    const totalDisciplines = allData.length;

    const s = {
      appVisited,
      topicsTouched: baseStats.topicsTouched,
      disciplinesTouched: disciplinesTouched.size,
      testsCount,
      testAvgPercent,
      examAttemptsCount: data.examAttempts.length,
      examAvgPercent,
      cardsReviewed: baseStats.cardsReviewed,
      streakDays: baseStats.streakDays,
      articlesPublished,
      notesCount
    };

    const CATEGORIES = [
      {
        id: 'start', title: 'Старт', desc: 'Первые шаги в приложении',
        items: [
          { title: 'Первое открытие', desc: 'Зайди в тренажёр', earned: s.appVisited },
          { title: 'Первая тема', desc: 'Открой любую тему', earned: s.topicsTouched >= 1 },
          { title: 'Первый тест', desc: 'Пройди первый тест', earned: s.testsCount >= 1 },
          { title: 'Первая карточка', desc: 'Повтори хотя бы одну карточку', earned: s.cardsReviewed >= 1 },
          { title: 'Первая заметка', desc: 'Запиши заметку по теме', earned: s.notesCount >= 1 }
        ]
      },
      {
        id: 'study', title: 'Учёба', desc: 'Изучение тем курса',
        items: [
          { title: '3 темы изучено', desc: 'Затронь 3 темы', earned: s.topicsTouched >= 3 },
          { title: '8 тем изучено', desc: 'Затронь 8 тем', earned: s.topicsTouched >= 8 },
          { title: '15 тем изучено', desc: 'Затронь 15 тем', earned: s.topicsTouched >= 15 },
          { title: '25 тем изучено', desc: 'Затронь 25 тем', earned: s.topicsTouched >= 25 },
          { title: 'Все темы изучены', desc: `Затронь все ${totalTopics} тем курса`, earned: s.topicsTouched >= totalTopics }
        ]
      },
      {
        id: 'tests', title: 'Тесты', desc: 'Прохождение и результаты тестов',
        items: [
          { title: 'Первый тест пройден', desc: 'Пройди 1 тест', earned: s.testsCount >= 1 },
          { title: '5 тестов пройдено', desc: 'Пройди 5 тестов', earned: s.testsCount >= 5 },
          { title: '15 тестов пройдено', desc: 'Пройди 15 тестов', earned: s.testsCount >= 15 },
          { title: 'Средний балл 80%+', desc: 'Держи средний результат тестов от 80%', earned: s.testAvgPercent >= 80 },
          { title: 'Средний балл 90%+', desc: 'Держи средний результат тестов от 90%', earned: s.testAvgPercent >= 90 }
        ]
      },
      {
        id: 'cards', title: 'Карточки', desc: 'Повторение карточек памяти',
        items: [
          { title: '10 карточек повторено', desc: '', earned: s.cardsReviewed >= 10 },
          { title: '30 карточек повторено', desc: '', earned: s.cardsReviewed >= 30 },
          { title: '75 карточек повторено', desc: '', earned: s.cardsReviewed >= 75 },
          { title: '150 карточек повторено', desc: '', earned: s.cardsReviewed >= 150 },
          { title: '300 карточек повторено', desc: '', earned: s.cardsReviewed >= 300 }
        ]
      },
      {
        id: 'streak', title: 'Серия', desc: 'Ежедневная активность',
        items: [
          { title: '3 дня подряд', desc: '', earned: s.streakDays >= 3 },
          { title: '7 дней подряд', desc: '', earned: s.streakDays >= 7 },
          { title: '14 дней подряд', desc: '', earned: s.streakDays >= 14 },
          { title: '30 дней подряд', desc: '', earned: s.streakDays >= 30 },
          { title: '60 дней подряд', desc: '', earned: s.streakDays >= 60 }
        ]
      },
      {
        id: 'explorer', title: 'Исследователь', desc: 'Изучение новых дисциплин',
        items: [
          { title: '1 дисциплина открыта', desc: '', earned: s.disciplinesTouched >= 1 },
          { title: '2 дисциплины открыты', desc: '', earned: s.disciplinesTouched >= 2 },
          { title: '3 дисциплины открыты', desc: '', earned: s.disciplinesTouched >= 3 },
          { title: 'Все дисциплины открыты', desc: `Затронь все ${totalDisciplines} дисциплин`, earned: s.disciplinesTouched >= totalDisciplines },
          { title: 'Полиглот права', desc: '15+ тем в разных дисциплинах', earned: s.topicsTouched >= 15 && s.disciplinesTouched >= 3 }
        ]
      },
      {
        id: 'community', title: 'Сообщество', desc: 'Публикации и вклад в базу знаний',
        items: [
          { title: 'Первая статья', desc: 'Опубликуй статью', earned: s.articlesPublished >= 1 },
          { title: '3 статьи опубликовано', desc: '', earned: s.articlesPublished >= 3 },
          { title: '5 статей опубликовано', desc: '', earned: s.articlesPublished >= 5 },
          { title: 'Конспектолог', desc: 'Заметки на 5 темах', earned: s.notesCount >= 5 },
          { title: '10 статей опубликовано', desc: '', earned: s.articlesPublished >= 10 }
        ]
      },
      {
        id: 'examiner', title: 'Экзаменатор', desc: 'Готовность к экзамену',
        items: [
          { title: '1 билет собран', desc: '', earned: s.examAttemptsCount >= 1 },
          { title: '3 билета собрано', desc: '', earned: s.examAttemptsCount >= 3 },
          { title: '5 билетов собрано', desc: '', earned: s.examAttemptsCount >= 5 },
          { title: 'Результат экзамена 80%+', desc: '', earned: s.examAvgPercent >= 80 },
          { title: 'Результат экзамена 95%+', desc: '', earned: s.examAvgPercent >= 95 }
        ]
      }
    ];

    let totalEarned = 0, totalCount = 0;
    CATEGORIES.forEach(cat => {
      cat.earnedCount = cat.items.filter(i => i.earned).length;
      cat.total = cat.items.length;
      totalEarned += cat.earnedCount;
      totalCount += cat.total;
    });

    return { categories: CATEGORIES, totalEarned, totalCount };
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

  /* ---------------- Tournament record (турниры на выбывание против ботов) --- */

  const TOURNEY_STATS_KEY = 'lexprep_tourney_stats';

  function getTournamentStats() {
    try {
      const raw = JSON.parse(localStorage.getItem(TOURNEY_STATS_KEY) || 'null');
      return Object.assign({ played: 0, champions: 0 }, raw || {});
    } catch (e) {
      return { played: 0, champions: 0 };
    }
  }

  function recordTournamentResult(isChampion) {
    const stats = getTournamentStats();
    stats.played++;
    if (isChampion) stats.champions++;
    localStorage.setItem(TOURNEY_STATS_KEY, JSON.stringify(stats));
    return stats;
  }

  return {
    getCardState,
    reviewCard,
    getDueCardIndexes,
    recordTestAttempt,
    recordExamAttempt,
    getWeakQuestions,
    getStats,
    findTopic,
    getTopicProgress,
    getDisciplineProgress,
    getGamification,
    getAchievements,
    getLevelInfo,
    getCoins,
    spendCoins,
    addCoins,
    getDuelStats,
    recordDuelResult,
    getTournamentStats,
    recordTournamentResult,
    RANKS
  };
})();
