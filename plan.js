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
  const DISCIPLINE_KEY = 'lexprep_basic_discipline';
  const TIER_RANK = { basic: 0, pro: 1, max: 2 };

  const LIMITS = {
    basic: { cardsPerDay: 15, testsPerDay: 1, testExplanations: false, duelsPerDay: 0, tourneysPerMonth: 0, pdfExport: false, examAttemptsPerMonth: 0 },
    pro: { cardsPerDay: Infinity, testsPerDay: 5, testExplanations: true, duelsPerDay: 3, tourneysPerMonth: 1, pdfExport: false, examAttemptsPerMonth: 3 },
    max: { cardsPerDay: Infinity, testsPerDay: Infinity, testExplanations: true, duelsPerDay: Infinity, tourneysPerMonth: 5, pdfExport: true, examAttemptsPerMonth: Infinity }
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
    return LIMITS[getTier()];
  }

  function getChosenDisciplineId(DATA) {
    const stored = localStorage.getItem(DISCIPLINE_KEY);
    if (stored && DATA.some(d => d.id === stored)) return stored;
    return DATA[0] && DATA[0].id;
  }

  function setChosenDisciplineId(id) {
    localStorage.setItem(DISCIPLINE_KEY, id);
  }

  function isDisciplineLocked(disciplineId, DATA) {
    return getTier() === 'basic' && disciplineId !== getChosenDisciplineId(DATA);
  }

  return {
    LIMITS,
    TIER_TITLES,
    getEffectivePlan,
    getTier,
    getLimits,
    getChosenDisciplineId,
    setChosenDisciplineId,
    isDisciplineLocked
  };
})();
