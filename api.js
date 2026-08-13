/* ==========================================================================
API.JS — тонкий клиент поверх Supabase (Auth + Postgres). Аутентификация и
профиль теперь настоящие — регистрация/вход идут через Supabase Auth,
имя/аватар/промокод хранятся в таблице public.profiles (см.
supabase/profiles.sql — этот скрипт нужно один раз выполнить в SQL Editor
проекта). Остальные системы (монеты, тарифы, дуэли, турниры, рейтинг)
по-прежнему живут в localStorage и сюда пока не переехали.
========================================================================== */

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';

const LexPrepApi = (function () {
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function friendlyError(error) {
    const known = {
      'Invalid login credentials': 'Неверный email или пароль.',
      'User already registered': 'Аккаунт с таким email уже существует.',
      'Email not confirmed': 'Email ещё не подтверждён — проверь почту и перейди по ссылке из письма.'
    };
    const err = new Error(known[error.message] || error.message);
    err.code = error.code || error.name;
    err.status = error.status;
    return err;
  }

  async function fetchProfile(userId) {
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
    if (error) throw friendlyError(error);
    return data;
  }

  // Приводим форму к тому, что уже ждёт остальной фронтенд (user.avatar,
  // не user.avatar_url), чтобы не переписывать каждое место использования.
  function toFrontendUser(authUser, profile) {
    if (!authUser) return null;
    return {
      id: authUser.id,
      email: authUser.email,
      name: (profile && profile.name) || authUser.email.split('@')[0],
      avatar: (profile && profile.avatar_url) || null,
      referralCode: profile && profile.referral_code,
      isAdmin: !!(profile && profile.is_admin),
      isBanned: !!(profile && profile.is_banned),
      banReason: profile && profile.ban_reason,
      bonusCoins: (profile && profile.bonus_coins) || 0,
      planTier: (profile && profile.plan_tier) || 'basic',
      planExpiresAt: profile && profile.plan_expires_at
    };
  }

  async function register({ name, email, password }) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });
    if (error) throw friendlyError(error);

    // Supabase не отдаёт ошибку на повторную регистрацию существующего
    // email (чтобы нельзя было перебором узнать, кто уже зарегистрирован)
    // — вместо этого возвращает user с пустым identities. Ловим это сами.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      const err = new Error('Аккаунт с таким email уже существует.');
      err.code = 'email_taken';
      throw err;
    }

    // mailer_autoconfirm выключен в проекте по умолчанию — сессии ещё
    // нет, пока человек не перейдёт по ссылке в письме.
    if (!data.session) {
      return { pendingConfirmation: true, email };
    }

    const profile = await fetchProfile(data.user.id);
    return { pendingConfirmation: false, user: toFrontendUser(data.user, profile) };
  }

  async function login({ email, password }) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw friendlyError(error);
    const profile = await fetchProfile(data.user.id);
    return toFrontendUser(data.user, profile);
  }

  async function logout() {
    const { error } = await client.auth.signOut();
    if (error) throw friendlyError(error);
  }

  async function me() {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      const err = new Error('not_authenticated');
      err.status = 401;
      throw err;
    }
    const profile = await fetchProfile(session.user.id);
    return toFrontendUser(session.user, profile);
  }

  async function updateProfile(patch) {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      const err = new Error('not_authenticated');
      err.status = 401;
      throw err;
    }

    const row = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.avatar !== undefined) row.avatar_url = patch.avatar || null;

    const { data, error } = await client
      .from('profiles')
      .update(row)
      .eq('id', session.user.id)
      .select()
      .single();
    if (error) throw friendlyError(error);

    return toFrontendUser(session.user, data);
  }

  /* ---------------- Админка ----------------
     Список/редактирование/бан идут напрямую в таблицу profiles — доступ
     ограничен RLS-политикой "Admins can update/view any profile"
     (см. supabase/admin.sql), обычному пользователю Supabase сам вернёт
     пустой результат или ошибку доступа. Реальное удаление аккаунта
     (auth.users) требует service_role и живёт в Edge Function
     admin-delete-user — её admin-статус вызывающего проверяет отдельно,
     ещё раз, на сервере. */

  async function requireSession() {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      const err = new Error('not_authenticated');
      err.status = 401;
      throw err;
    }
    return session;
  }

  async function adminListUsers() {
    await requireSession();
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw friendlyError(error);
    return data.map(p => ({
      id: p.id,
      email: p.email,
      name: p.name,
      avatar: p.avatar_url,
      isAdmin: !!p.is_admin,
      isBanned: !!p.is_banned,
      banReason: p.ban_reason,
      bonusCoins: p.bonus_coins || 0,
      planTier: p.plan_tier || 'basic',
      planExpiresAt: p.plan_expires_at,
      createdAt: p.created_at
    }));
  }

  async function adminUpdateUser(userId, patch) {
    await requireSession();
    const row = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.avatar !== undefined) row.avatar_url = patch.avatar || null;
    if (patch.isBanned !== undefined) row.is_banned = patch.isBanned;
    if (patch.banReason !== undefined) row.ban_reason = patch.banReason || null;
    if (patch.bonusCoins !== undefined) row.bonus_coins = patch.bonusCoins;
    if (patch.planTier !== undefined) row.plan_tier = patch.planTier;
    if (patch.planExpiresAt !== undefined) row.plan_expires_at = patch.planExpiresAt;

    const { data, error } = await client
      .from('profiles')
      .update(row)
      .eq('id', userId)
      .select()
      .single();
    if (error) throw friendlyError(error);
    return data;
  }

  async function adminGrantCoins(userId, amount, currentBonus) {
    return adminUpdateUser(userId, { bonusCoins: (currentBonus || 0) + amount });
  }

  async function adminGrantSubscription(userId, tier, days) {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    return adminUpdateUser(userId, { planTier: tier, planExpiresAt: expires });
  }

  async function adminSetBanned(userId, isBanned, reason) {
    return adminUpdateUser(userId, { isBanned, banReason: isBanned ? (reason || 'Без указания причины') : null });
  }

  async function adminDeleteUser(userId) {
    const session = await requireSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-delete-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ userId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Не удалось удалить аккаунт.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    register, login, logout, me, updateProfile, toFrontendUser,
    adminListUsers, adminUpdateUser, adminGrantCoins, adminGrantSubscription, adminSetBanned, adminDeleteUser
  };
})();
