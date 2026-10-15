/* ==========================================================================
ACCOUNT-SCOPE.JS — локальный прогресс принадлежит конкретному аккаунту.

Опыт, монеты, карточки, статистика, заметки, тариф за монеты, история
ИИ-чата и т.п. хранятся в localStorage под общими ключами. Раньше при
выходе они оставались в браузере, и следующий аккаунт (в том числе только
что зарегистрированный) получал чужой прогресс, а опыт уходил на сервер в
рейтинг.

Теперь в lexprep_data_owner записано, чей это прогресс. Если на странице
другой пользователь (или гость), данные прежнего владельца откладываются
в lexprep_stash:<id>, а данные нового — достаются из его «тайника» или
начинаются с нуля. Гостевые данные в аккаунт не переносятся.

Подключается в <head> раньше всех остальных скриптов, чтобы подмена
произошла до того, как страница что-то прочитает.
========================================================================== */

(function () {
  const OWNER_KEY = 'lexprep_data_owner';
  const STASH_PREFIX = 'lexprep_stash:';
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
    'lexprep_visited_app'
  ];

  function storage() {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  function currentUserId(ls) {
    try {
      const user = JSON.parse(ls.getItem('lexprep_user') || 'null');
      return user && user.id ? String(user.id) : GUEST;
    } catch (e) {
      return GUEST;
    }
  }

  function snapshot(ls) {
    const data = {};
    PER_USER_KEYS.forEach(key => {
      const value = ls.getItem(key);
      if (value !== null) data[key] = value;
    });
    return data;
  }

  function clear(ls) {
    PER_USER_KEYS.forEach(key => ls.removeItem(key));
  }

  function sync() {
    const ls = storage();
    if (!ls) return;
    try {
      const now = currentUserId(ls);
      const owner = ls.getItem(OWNER_KEY);

      // Первый запуск этой версии: всё, что уже лежит в браузере, считаем
      // данными того, кто сейчас на странице.
      if (owner === null) {
        ls.setItem(OWNER_KEY, now);
        return;
      }
      if (owner === now) return;

      // Прежний владелец — пользователь: откладываем его данные до
      // следующего входа. Гостевые данные просто выбрасываем.
      if (owner !== GUEST) {
        try {
          ls.setItem(STASH_PREFIX + owner, JSON.stringify(snapshot(ls)));
        } catch (e) {
          // Не хватило места — данные прежнего аккаунта на этом устройстве
          // потеряются, но чужому аккаунту они всё равно не достанутся.
        }
      }
      clear(ls);

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
    } catch (e) {
      // Сбой разделения не должен ломать сайт.
    }
  }

  // Удаление аккаунта: стираем данные этого пользователя на устройстве,
  // не трогая «тайники» других аккаунтов.
  function forgetCurrent() {
    const ls = storage();
    if (!ls) return;
    try {
      const owner = ls.getItem(OWNER_KEY);
      clear(ls);
      if (owner && owner !== GUEST) ls.removeItem(STASH_PREFIX + owner);
      ls.removeItem('lexprep_user');
      ls.setItem(OWNER_KEY, GUEST);
    } catch (e) { /* ignore */ }
  }

  sync();
  window.LexPrepAccountScope = { sync, forgetCurrent };
})();
