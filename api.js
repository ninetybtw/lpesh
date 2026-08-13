/* ==========================================================================
API.JS — тонкий клиент для LexPrep API (backend/). Пока бэкенд реализует
только аутентификацию и профиль — остальные функции (монеты, тарифы,
дуэли, турниры, рейтинг) по-прежнему живут в localStorage и сюда не
переехали. Сессия — httpOnly cookie, поэтому все запросы идут с
credentials: 'include', а не с токеном в заголовке.
========================================================================== */

// В проде это должно стать адресом задеплоенного API, а не localhost —
// пока бэкенд запускается только локально рядом с фронтендом.
const LEXPREP_API_BASE = 'http://localhost:4000/api';

const LexPrepApi = (function () {
  async function request(path, options = {}) {
    let res;
    try {
      res = await fetch(`${LEXPREP_API_BASE}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
    } catch (e) {
      const error = new Error('Не удалось связаться с сервером. Проверь, что бэкенд запущен.');
      error.code = 'network_error';
      throw error;
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // пустое тело (например, у /logout) — не ошибка
    }

    if (!res.ok) {
      const error = new Error((data && data.message) || 'Не удалось выполнить запрос.');
      error.status = res.status;
      error.code = data && data.error;
      throw error;
    }

    return data;
  }

  // Бэкенд отдаёт avatarUrl, а весь остальной фронтенд уже написан на
  // user.avatar — приводим форму к тому, что ждут остальные страницы,
  // вместо переписывания каждого места использования.
  function toFrontendUser(apiUser) {
    if (!apiUser) return null;
    return {
      id: apiUser.id,
      name: apiUser.name,
      email: apiUser.email,
      avatar: apiUser.avatarUrl || null,
      referralCode: apiUser.referralCode
    };
  }

  function register(payload) {
    return request('/auth/register', { method: 'POST', body: JSON.stringify(payload) })
      .then(data => toFrontendUser(data.user));
  }

  function login(payload) {
    return request('/auth/login', { method: 'POST', body: JSON.stringify(payload) })
      .then(data => toFrontendUser(data.user));
  }

  function logout() {
    return request('/auth/logout', { method: 'POST' });
  }

  function me() {
    return request('/auth/me').then(data => toFrontendUser(data.user));
  }

  function updateProfile(patch) {
    const body = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.avatar !== undefined) body.avatarUrl = patch.avatar;
    return request('/profile', { method: 'PATCH', body: JSON.stringify(body) })
      .then(data => toFrontendUser(data.user));
  }

  function deleteAccount() {
    return request('/profile', { method: 'DELETE' });
  }

  return { register, login, logout, me, updateProfile, deleteAccount, toFrontendUser };
})();
