/* ==========================================================================
PLAN.JS — разрешение действующего тарифа пользователя и лимитов по нему.
Источник тарифа — два места, действует более высокий из двух (см.
getEffectivePlan): profiles.plan_tier/plan_expires_at на сервере (ставится
админом, кэшируется в localStorage.lexprep_user при логине) и локальный
апгрейд за монеты из магазина (localStorage, shop.js). Цифры лимитов взяты
из текста тарифов на index.html.
========================================================================== */

const LexPrepPlan = (function () {
  const PLAN_TIER_KEY = 'lexprep_plan_tier';
  const PLAN_EXPIRES_KEY = 'lexprep_plan_expires';
  const TIER_RANK = { basic: 0, pro: 1, max: 2 };

  // Дуэли/турниры/тесты у "про" и "максимум" зависят ещё и от периода
  // оплаты — годовая подписка даёт больше (см. price-card на
  // index.html#pricing). Помесячные значения — те же, что были всегда;
  // getLimits() ниже сам выбирает нужный набор через hasAnnualPlan().
  const LIMITS = {
    basic: { cardsPerDay: 15, testsPerDay: 1, testExplanations: false, duelsPerDay: 0, tourneysPerMonth: 0, pdfExport: false, examAttemptsPerMonth: 0 },
    pro: {
      monthly: { cardsPerDay: Infinity, testsPerDay: 3, testExplanations: true, duelsPerDay: 3, tourneysPerMonth: 1, pdfExport: false, examAttemptsPerMonth: 3 },
      annual: { cardsPerDay: Infinity, testsPerDay: 5, testExplanations: true, duelsPerDay: 5, tourneysPerMonth: 3, pdfExport: false, examAttemptsPerMonth: 3 }
    },
    max: {
      monthly: { cardsPerDay: Infinity, testsPerDay: Infinity, testExplanations: true, duelsPerDay: Infinity, tourneysPerMonth: 5, pdfExport: true, examAttemptsPerMonth: Infinity },
      annual: { cardsPerDay: Infinity, testsPerDay: Infinity, testExplanations: true, duelsPerDay: Infinity, tourneysPerMonth: 10, pdfExport: true, examAttemptsPerMonth: Infinity }
    }
  };

  const TIER_TITLES = { basic: 'Базовый', pro: 'Про', max: 'Максимум' };

  // Тариф может быть куплен за монеты локально или выдан админом на
  // сервере — действует более высокий из двух источников.
  function getEffectivePlan() {
    const localTier = localStorage.getItem(PLAN_TIER_KEY) || 'basic';
    const localExpires = Number(localStorage.getItem(PLAN_EXPIRES_KEY) || 0);
    const localValid = localTier !== 'basic' && Date.now() <= localExpires;

    let serverTier = 'basic';
    let serverExpires = 0;
    try {
      const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
      if (user && user.planTier && user.planExpiresAt) {
        serverTier = user.planTier;
        serverExpires = new Date(user.planExpiresAt).getTime();
      }
    } catch (e) { /* ignore */ }
    const serverValid = serverTier !== 'basic' && Date.now() <= serverExpires;

    if (!localValid && !serverValid) return { tier: 'basic', expires: 0 };
    if (localValid && !serverValid) return { tier: localTier, expires: localExpires };
    if (!localValid && serverValid) return { tier: serverTier, expires: serverExpires };

    return TIER_RANK[serverTier] >= TIER_RANK[localTier]
      ? { tier: serverTier, expires: serverExpires }
      : { tier: localTier, expires: localExpires };
  }

  function getTier() {
    return getEffectivePlan().tier;
  }

  function getLimits() {
    const tier = getTier();
    const tierLimits = LIMITS[tier];
    if (tier === 'basic') return tierLimits;
    return hasAnnualPlan() ? tierLimits.annual : tierLimits.monthly;
  }

  // Дисциплина на "Базовом" — фиксированная (Гражданское право), больше
  // не выбирается пользователем. DATA[0] как запасной вариант — только
  // на случай, если 'civil' почему-то не найдётся в данных.
  const BASIC_DISCIPLINE_ID = 'civil';

  function getChosenDisciplineId(DATA) {
    if (DATA.some(d => d.id === BASIC_DISCIPLINE_ID)) return BASIC_DISCIPLINE_ID;
    return DATA[0] && DATA[0].id;
  }

  function isDisciplineLocked(disciplineId, DATA) {
    return getTier() === 'basic' && disciplineId !== getChosenDisciplineId(DATA);
  }

  // "Продвинутый" ИИ-консультант — доступен только тем, у кого действующий
  // тариф выдан на сервере (админом) с periodом 'annual', то есть кто
  // фактически оплатил подписку сразу на год. Локальный тариф, купленный
  // в магазине за монеты, никогда не даёт этот статус — там нет понятия
  // годовой оплаты (см. shop.js). Если локальный шоп-тариф сейчас выше
  // серверного и именно он определяет getTier(), продвинутый консультант
  // тоже не включается — реальная годовая подписка должна быть активна
  // именно как источник текущего тарифа.
  function hasAnnualPlan() {
    if (getTier() === 'basic') return false;
    try {
      const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
      if (!user || user.planBillingPeriod !== 'annual') return false;
      if (!user.planTier || user.planTier === 'basic') return false;
      if (user.planTier !== getTier()) return false;
      const serverExpires = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : 0;
      return Date.now() <= serverExpires;
    } catch (e) {
      return false;
    }
  }

  return {
    LIMITS,
    TIER_TITLES,
    TIER_RANK,
    getEffectivePlan,
    getTier,
    getLimits,
    getChosenDisciplineId,
    isDisciplineLocked,
    hasAnnualPlan
  };
})();
