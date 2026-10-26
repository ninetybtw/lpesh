/* ==========================================================================
ACCOUNT-SCOPE.JS — локальный прогресс принадлежит аккаунту и одинаков на
всех его устройствах.

Опыт, монеты, карточки, статистика, заметки, тариф за монеты, история
ИИ-чата и т.п. хранятся в localStorage. Здесь две вещи:

1. Владелец данных. В lexprep_data_owner записано, чей это прогресс. Если
   на странице другой пользователь (или гость), данные прежнего владельца
   откладываются в lexprep_stash:<id>, а данные нового достаются из его
   «тайника» или начинаются с нуля. Иначе новый аккаунт в том же браузере
   получал чужой прогресс.

2. Синхронизация между устройствами (supabase/progress-sync.sql). При
   открытии страницы и через несколько секунд после любых изменений
   локальные данные сливаются с серверной копией: карточки, попытки
   тестов, экзамены и прочитанные конспекты объединяются, монеты — по
   максимуму, остальное — по более свежему изменению. Так уровень и опыт на
   телефоне и компьютере совпадают.

Подключается в <head> раньше всех остальных скриптов.
========================================================================== */

(function () {
  const OWNER_KEY = 'lexprep_data_owner';
  const STASH_PREFIX = 'lexprep_stash:';
  const MTIMES_KEY = 'lexprep_sync_mtimes';
  const GUEST = 'guest';

  // Ключи, данные которых принадлежат пользователю. Тема, согласие на
  // cookies, шрифт библиотеки и т.п. — настройки браузера, их не трогаем.
  const PER_USER_KEYS = [
    'lexprep_progress',
    'lexprep_coins_spent',
    'lexprep_coins_bonus',
    'lexprep_inventory',
    'lexprep_duel_stats',
    'lexprep_tourney_stats',
    'lexprep_last_seen_level',
    'lexprep_plan_tier',
    'lexprep_plan_expires',
    'lexprep_shop_equipped',
    'lexprep_notes',
    'lexprep_notifications',
    'lexprep_ai_chat_history',
    'lexprep_article_draft',
    'lexprep_article_history',
    'lexprep_library_read',
    'lexprep_library_last',
    'lexprep_visited_app',
    MTIMES_KEY
  ];

  // Что уходит на сервер. Переписка с ИИ, черновик статьи и «последний
  // показанный уровень» остаются на устройстве.
  const SYNC_KEYS = [
    'lexprep_progress',
    'lexprep_coins_spent',
    'lexprep_coins_bonus',
    'lexprep_inventory',
    'lexprep_duel_stats',
    'lexprep_tourney_stats',
    'lexprep_plan_tier',
    'lexprep_plan_expires',
    'lexprep_shop_equipped',
    'lexprep_notes',
    'lexprep_notifications',
    'lexprep_article_history',
    'lexprep_library_read',
    'lexprep_library_last',
    'lexprep_visited_app'
  ];

  let ls = null;
  try {
    ls = window.localStorage;
  } catch (e) {
    ls = null;
  }
  if (!ls) return;

  // Записи, которые делает сам этот модуль (подмена владельца, слияние),
  // не считаются «изменениями пользователя».
  let applying = false;
  const rawSet = Storage.prototype.setItem;
  const rawRemove = Storage.prototype.removeItem;

  function quietly(fn) {
    applying = true;
    try {
      return fn();
    } finally {
      applying = false;
    }
  }

  function readMtimes() {
    try {
      return JSON.parse(ls.getItem(MTIMES_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function writeMtimes(mtimes) {
    quietly(() => ls.setItem(MTIMES_KEY, JSON.stringify(mtimes)));
  }

  function currentUserId() {
    try {
      const user = JSON.parse(ls.getItem('lexprep_user') || 'null');
      return user && user.id ? String(user.id) : GUEST;
    } catch (e) {
      return GUEST;
    }
  }

  function snapshot(keys) {
    const data = {};
    keys.forEach(key => {
      const value = ls.getItem(key);
      if (value !== null) data[key] = value;
    });
    return data;
  }

  /* ---------------- 1. Владелец данных ---------------- */

  function sync(forceUid) {
    try {
      quietly(() => {
        const now = forceUid || currentUserId();
        const owner = ls.getItem(OWNER_KEY);

        // Вошёл, но данные числились за гостем (кэш пользователя ещё не
        // успел сохраниться) — это его же занятия, оставляем их ему.
        if (forceUid && owner === GUEST && !ls.getItem(STASH_PREFIX + forceUid)) {
          ls.setItem(OWNER_KEY, forceUid);
          return;
        }

        // Первый запуск этой версии: всё, что уже лежит в браузере,
        // считаем данными того, кто сейчас на странице.
        if (owner === null) {
          ls.setItem(OWNER_KEY, now);
          return;
        }
        if (owner === now) return;

        // Прежний владелец — пользователь: откладываем его данные до
        // следующего входа. Гостевые данные просто выбрасываем.
        if (owner !== GUEST) {
          try {
            ls.setItem(STASH_PREFIX + owner, JSON.stringify(snapshot(PER_USER_KEYS)));
          } catch (e) {
            // Не хватило места — данные прежнего аккаунта на этом
            // устройстве потеряются, но чужому аккаунту не достанутся.
          }
        }
        PER_USER_KEYS.forEach(key => ls.removeItem(key));

        if (now !== GUEST) {
          const stashKey = STASH_PREFIX + now;
          const raw = ls.getItem(stashKey);
          if (raw) {
            const saved = JSON.parse(raw) || {};
            Object.keys(saved).forEach(key => {
              if (PER_USER_KEYS.includes(key)) ls.setItem(key, saved[key]);
            });
            ls.removeItem(stashKey);
          }
        }
        ls.setItem(OWNER_KEY, now);
      });
    } catch (e) {
      // Сбой разделения не должен ломать сайт.
    }
  }

  // Удаление аккаунта: стираем данные этого пользователя на устройстве,
  // не трогая «тайники» других аккаунтов.
  function forgetCurrent() {
    try {
      quietly(() => {
        const owner = ls.getItem(OWNER_KEY);
        PER_USER_KEYS.forEach(key => ls.removeItem(key));
        if (owner && owner !== GUEST) ls.removeItem(STASH_PREFIX + owner);
        ls.removeItem('lexprep_user');
        ls.setItem(OWNER_KEY, GUEST);
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 2. Синхронизация между устройствами ---------------- */

  function parseJson(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function attemptKey(a) {
    return `${a && a.date}|${a && a.score}|${a && a.total}`;
  }

  function unionAttempts(a, b) {
    const seen = new Map();
    [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].forEach(x => {
      if (x && !seen.has(attemptKey(x))) seen.set(attemptKey(x), x);
    });
    return [...seen.values()].sort((x, y) => (x.date || 0) - (y.date || 0));
  }

  function mergeUsage(a, b, field) {
    if (!a) return b || null;
    if (!b) return a;
    if (a[field] !== b[field]) {
      // Разные дни/месяцы — актуален более поздний.
      const ta = field === 'day' ? Date.parse(a.day) : Date.parse(`${a.month}-01`);
      const tb = field === 'day' ? Date.parse(b.day) : Date.parse(`${b.month}-01`);
      return (tb || 0) > (ta || 0) ? b : a;
    }
    const out = { ...a };
    Object.keys(b).forEach(k => {
      if (typeof b[k] === 'number') out[k] = Math.max(Number(a[k]) || 0, b[k]);
    });
    return out;
  }

  // Прогресс обучения: занятия с обоих устройств складываются.
  function mergeProgress(localRaw, serverRaw, localNewer) {
    const l = parseJson(localRaw, {});
    const s = parseJson(serverRaw, {});
    const newer = localNewer ? l : s;
    const out = { ...s, ...l };

    out.cards = {};
    const lc = l.cards || {};
    const sc = s.cards || {};
    new Set([...Object.keys(lc), ...Object.keys(sc)]).forEach(k => {
      const a = lc[k];
      const b = sc[k];
      if (!a || !b) { out.cards[k] = a || b; return; }
      const ar = a.reviews || 0;
      const br = b.reviews || 0;
      out.cards[k] = ar !== br ? (ar > br ? a : b) : ((a.due || 0) >= (b.due || 0) ? a : b);
    });

    out.tests = {};
    const lt = l.tests || {};
    const st = s.tests || {};
    new Set([...Object.keys(lt), ...Object.keys(st)]).forEach(k => {
      out.tests[k] = unionAttempts(lt[k], st[k]);
    });

    out.examAttempts = unionAttempts(l.examAttempts, s.examAttempts);

    out.theoryRead = { ...(s.theoryRead || {}) };
    Object.keys(l.theoryRead || {}).forEach(k => {
      const a = l.theoryRead[k];
      const b = out.theoryRead[k];
      out.theoryRead[k] = b ? Math.min(a, b) : a;
    });

    // Слабые места при правильном ответе удаляются — берём их из более
    // свежей копии, чтобы не воскрешать исправленное.
    out.weak = newer.weak || {};

    out.dailyUsage = mergeUsage(l.dailyUsage, s.dailyUsage, 'day');
    out.monthlyUsage = mergeUsage(l.monthlyUsage, s.monthlyUsage, 'month');
    return JSON.stringify(out);
  }

  function mergeKey(key, local, server, lm, sm) {
    if (local == null) return server;
    if (server == null) return local;
    const localNewer = (lm || 0) >= (sm || 0);
    switch (key) {
      case 'lexprep_progress':
        return mergeProgress(local, server, localNewer);
      case 'lexprep_coins_spent':
      case 'lexprep_coins_bonus':
        // Только растут — максимум не теряет ни трат, ни бонусов.
        return String(Math.max(Number(local) || 0, Number(server) || 0));
      case 'lexprep_visited_app':
        return local === '1' || server === '1' ? '1' : local;
      case 'lexprep_notes':
      case 'lexprep_library_read':
      case 'lexprep_library_last': {
        const a = parseJson(local, {});
        const b = parseJson(server, {});
        return JSON.stringify(localNewer ? { ...b, ...a } : { ...a, ...b });
      }
      default:
        return localNewer ? local : server;
    }
  }

  function hasLearning(raw) {
    const p = parseJson(raw, {});
    return !!(Object.keys(p.cards || {}).length || Object.keys(p.tests || {}).length
      || Object.keys(p.theoryRead || {}).length || (p.examAttempts || []).length);
  }

  // api.js и progress.js объявляют LexPrepApi/LexPrepProgress через const —
  // такие имена видны всем скриптам страницы, но в window их нет.
  function api() {
    const lexApi = typeof LexPrepApi !== 'undefined' ? LexPrepApi : window.LexPrepApi;
    return lexApi && typeof lexApi.getClient === 'function' ? lexApi : null;
  }

  function progressApi() {
    const progress = typeof LexPrepProgress !== 'undefined' ? LexPrepProgress : window.LexPrepProgress;
    return progress && typeof progress.getGamification === 'function' ? progress : null;
  }

  function currentXp() {
    try {
      const progress = progressApi();
      return progress ? progress.getGamification().xp : null;
    } catch (e) {
      return null;
    }
  }

  function isMissingTable(error) {
    return error && (error.code === '42P01' || error.code === 'PGRST205' || error.status === 404);
  }

  let syncDisabled = false;
  let firstSyncDone = false;
  let syncing = null;
  let pendingAgain = false;
  let pushTimer = null;

  async function syncWithServer() {
    if (syncDisabled) return;
    if (syncing) {
      pendingAgain = true;
      return syncing;
    }
    syncing = (async () => {
      const lexApi = api();
      if (!lexApi) return;
      const client = lexApi.getClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session) return;
      const uid = session.user.id;
      // Хозяин данных — тот, чья сессия. Если кэш пользователя устарел или
      // ещё не сохранился, данные всё равно переключаются на этот аккаунт.
      if (ls.getItem(OWNER_KEY) !== uid) sync(uid);
      if (ls.getItem(OWNER_KEY) !== uid) return;

      const { data: row, error } = await client.from('user_progress')
        .select('data, mtimes').eq('user_id', uid).maybeSingle();
      if (error) {
        // Таблицы ещё нет (не выполнен progress-sync.sql) — работаем как
        // раньше. Сбой сети и т.п. — попробуем при следующем изменении.
        if (isMissingTable(error)) syncDisabled = true;
        else console.warn('LexPrep: не удалось получить прогресс с сервера', error.message);
        return;
      }
      const xpBefore = currentXp();
      const server = { data: (row && row.data) || {}, mtimes: (row && row.mtimes) || {} };
      const local = { data: snapshot(SYNC_KEYS), mtimes: readMtimes() };

      const merged = { data: {}, mtimes: {} };
      let localChanged = false;
      let serverChanged = !row;
      SYNC_KEYS.forEach(key => {
        const value = mergeKey(key, local.data[key], server.data[key], local.mtimes[key], server.mtimes[key]);
        const mtime = Math.max(Number(local.mtimes[key]) || 0, Number(server.mtimes[key]) || 0);
        if (value != null) merged.data[key] = value;
        if (mtime) merged.mtimes[key] = mtime;
        if (value !== local.data[key]) localChanged = true;
        if (value !== server.data[key]) serverChanged = true;
      });

      if (localChanged) {
        quietly(() => {
          SYNC_KEYS.forEach(key => {
            if (merged.data[key] == null) ls.removeItem(key);
            else if (merged.data[key] !== ls.getItem(key)) ls.setItem(key, merged.data[key]);
          });
        });
      }
      writeMtimes({ ...readMtimes(), ...merged.mtimes });

      if (serverChanged) {
        const { error: upErr } = await client.from('user_progress').upsert({
          user_id: uid,
          data: merged.data,
          mtimes: merged.mtimes,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (upErr) console.warn('LexPrep: прогресс не сохранился на сервере', upErr.message);
      }

      if (localChanged) {
        // Уровень пересчитался — запоминаем его без всплывающего «новый
        // уровень» и обновляем опыт в рейтинге.
        const progress = progressApi();
        if (progress) {
          const g = progress.getGamification();
          quietly(() => ls.setItem('lexprep_last_seen_level', String(g.level)));
          if (lexApi.syncXp) await lexApi.syncXp(g.xp).catch(() => {});
        }
      }

      // С сервера пришли занятия с другого устройства, а страница уже
      // нарисована по старым данным — один раз перезагружаем, чтобы везде
      // были настоящие уровень, опыт и пройденные темы.
      const xpAfter = currentXp();
      const progressGrew = (!hasLearning(local.data.lexprep_progress) && hasLearning(merged.data.lexprep_progress))
        || (xpBefore != null && xpAfter != null && xpAfter > xpBefore);
      const isFirstSync = !firstSyncDone;
      firstSyncDone = true;
      // Перезагружаем только сразу после открытия страницы, чтобы не сбить
      // человеку тест или карточки посреди занятия.
      if (localChanged && progressGrew && isFirstSync) {
        let reloaded = false;
        try {
          reloaded = sessionStorage.getItem('lexprep_progress_reloaded') === '1';
          sessionStorage.setItem('lexprep_progress_reloaded', '1');
        } catch (e) { reloaded = true; }
        if (!reloaded) {
          window.location.reload();
          return;
        }
      }

      if (localChanged) window.dispatchEvent(new CustomEvent('lexprep:progress-synced'));
    })().catch(e => {
      console.warn('LexPrep: синхронизация прогресса не удалась', e && e.message);
    }).finally(() => {
      syncing = null;
      if (pendingAgain) {
        pendingAgain = false;
        schedulePush(1000);
      }
    });
    return syncing;
  }

  function schedulePush(delay) {
    if (syncDisabled) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncWithServer, delay == null ? 4000 : delay);
  }

  // Отмечаем время изменения ключей прогресса — по нему выбирается более
  // свежая версия при слиянии.
  Storage.prototype.setItem = function (key, value) {
    rawSet.call(this, key, value);
    if (!applying && this === ls && SYNC_KEYS.includes(key)) {
      const m = readMtimes();
      m[key] = Date.now();
      writeMtimes(m);
      schedulePush();
    }
  };
  Storage.prototype.removeItem = function (key) {
    rawRemove.call(this, key);
    if (!applying && this === ls && SYNC_KEYS.includes(key)) {
      const m = readMtimes();
      m[key] = Date.now();
      writeMtimes(m);
      schedulePush();
    }
  };

  sync();

  function start() {
    syncWithServer();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && pushTimer) {
        clearTimeout(pushTimer);
        syncWithServer();
      } else if (document.visibilityState === 'visible') {
        schedulePush(500);
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.LexPrepAccountScope = { sync, forgetCurrent, syncNow: syncWithServer };
})();
