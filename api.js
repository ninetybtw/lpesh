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

const DUEL_ERROR_MESSAGES = {
  challenge_not_found: 'Этот вызов уже недоступен — возможно, его отменили.',
  challenge_not_open: 'Этот вызов уже кто-то принял.',
  cannot_accept_own_challenge: 'Нельзя принять собственный вызов.',
  challenge_not_active: 'Эта дуэль ещё не началась или уже завершена.',
  already_submitted: 'Счёт по этой дуэли уже отправлен.',
  not_a_participant: 'Ты не участник этой дуэли.',
  invalid_score: 'Некорректный счёт.'
};

const LexPrepApi = (function () {
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function friendlyError(error) {
    const known = {
      'Invalid login credentials': 'Неверный email или пароль.',
      'User already registered': 'Аккаунт с таким email уже существует.',
      'Email not confirmed': 'Email ещё не подтверждён — проверь почту и перейди по ссылке из письма.'
    };
    let message = known[error.message] || error.message;
    // Postgres-ошибки из profiles (уникальность промокода, кастомные
    // exception из триггеров) — код 23505 и текст raise exception
    // приходят как есть, переводим их в понятные формулировки.
    if (error.code === '23505' && /referral_code/.test(error.details || error.message || '')) {
      message = 'Такой промокод уже занят — попробуй другой.';
    } else if (error.message === 'invalid_referral_code') {
      message = error.details || 'Промокод: 3-20 символов, латинские буквы, цифры и дефис.';
    } else if (error.code === '23505' && /suggestion_votes/.test(error.details || error.message || '')) {
      message = 'Ты уже голосовал за это предложение.';
    } else if (DUEL_ERROR_MESSAGES[error.message]) {
      message = DUEL_ERROR_MESSAGES[error.message];
    }
    const err = new Error(message);
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
      isModerator: !!(profile && profile.is_moderator),
      isBanned: !!(profile && profile.is_banned),
      banReason: profile && profile.ban_reason,
      bonusCoins: (profile && profile.bonus_coins) || 0,
      planTier: (profile && profile.plan_tier) || 'basic',
      planExpiresAt: profile && profile.plan_expires_at,
      duelRating: (profile && profile.duel_rating) || 1000,
      aiExtraRequests: (profile && profile.ai_extra_requests) || 0
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
    if (patch.referralCode !== undefined) row.referral_code = patch.referralCode;

    const { data, error } = await client
      .from('profiles')
      .update(row)
      .eq('id', session.user.id)
      .select()
      .single();
    if (error) throw friendlyError(error);

    return toFrontendUser(session.user, data);
  }

  // Докупленные в магазине запросы к ИИ-консультанту сверх дневного
  // лимита (см. shop.js, supabase/ai-extra-requests.sql) — Edge Function
  // ai-consultant списывает их сама, когда дневной лимит исчерпан.
  // currentValue передаётся вызывающим кодом (из уже загруженного
  // user.aiExtraRequests), чтобы не делать лишний round-trip за ним сюда.
  async function addAiExtraRequests(amount, currentValue) {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      const err = new Error('not_authenticated');
      err.status = 401;
      throw err;
    }
    const { data, error } = await client
      .from('profiles')
      .update({ ai_extra_requests: (currentValue || 0) + amount })
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
      isModerator: !!p.is_moderator,
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
    if (patch.isModerator !== undefined) row.is_moderator = patch.isModerator;

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

  async function adminSetModerator(userId, isModerator) {
    return adminUpdateUser(userId, { isModerator });
  }

  // Модератор тоже может начислять монеты, но не больше +250 за раз —
  // ограничение дублируется здесь на клиенте для понятной ошибки, а на
  // сервере его всё равно жёстко проверяет триггер
  // enforce_profile_update_permissions (см. supabase/moderator.sql).
  const MODERATOR_COIN_GRANT_LIMIT = 250;
  async function moderatorGrantCoins(userId, amount, currentBonus) {
    if (amount > MODERATOR_COIN_GRANT_LIMIT) {
      throw new Error(`Модератор может начислить не больше ${MODERATOR_COIN_GRANT_LIMIT} монет за раз.`);
    }
    return adminGrantCoins(userId, amount, currentBonus);
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

  /* ---------------- Журнал действий админов/модераторов ----------------
     public.admin_audit_log (см. supabase/admin-audit-log.sql). Пишет
     сюда сам фронтенд сразу после успешного действия — не подмена
     нормального сервера аудита, но лучше, чем ничего, и не даёт
     модератору незаметно замести следы (insert разрешён только "от
     своего имени", RLS без update/delete). Видит журнал только админ. */

  async function logAdminAction(action, opts) {
    opts = opts || {};
    try {
      const session = await requireSession();
      const me = await fetchProfile(session.user.id);
      await client.from('admin_audit_log').insert({
        actor_id: session.user.id,
        actor_name: me.name || session.user.email,
        actor_role: me.is_admin ? 'admin' : 'moderator',
        action,
        target_user_id: opts.targetUserId || null,
        target_label: opts.targetLabel || null,
        details: opts.details || null
      });
    } catch (e) {
      // Журнал — вспомогательная функция, не должен ронять само
      // действие админа/модератора, если запись лога не удалась.
      console.error('LexPrep: не удалось записать в журнал действий', e);
    }
  }

  async function adminListAuditLog(limit) {
    await requireSession();
    const { data, error } = await client
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit || 200);
    if (error) throw friendlyError(error);
    return data.map(row => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      action: row.action,
      targetUserId: row.target_user_id,
      targetLabel: row.target_label,
      details: row.details,
      createdAt: row.created_at
    }));
  }

  /* ---------------- Поддержка ----------------
     Тикеты живут в public.support_tickets (см.
     supabase/support-suggestions.sql). Пользователь видит и создаёт
     только свои, ответ пишет админ через adminReplyTicket. */

  function toFrontendTicket(t) {
    return {
      id: t.id,
      subject: t.subject,
      message: t.message,
      status: t.status,
      adminReply: t.admin_reply,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      userId: t.user_id
    };
  }

  async function createSupportTicket({ subject, message }) {
    const session = await requireSession();
    const { data, error } = await client
      .from('support_tickets')
      .insert({ user_id: session.user.id, subject, message })
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendTicket(data);
  }

  async function listMySupportTickets() {
    const session = await requireSession();
    const { data, error } = await client
      .from('support_tickets')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    if (error) throw friendlyError(error);
    return data.map(toFrontendTicket);
  }

  async function adminListSupportTickets() {
    await requireSession();
    const { data, error } = await client
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw friendlyError(error);
    return data.map(toFrontendTicket);
  }

  async function adminReplyTicket(ticketId, reply) {
    await requireSession();
    const { data, error } = await client
      .from('support_tickets')
      .update({ admin_reply: reply, status: 'answered' })
      .eq('id', ticketId)
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendTicket(data);
  }

  async function adminSetTicketStatus(ticketId, status) {
    await requireSession();
    const { data, error } = await client
      .from('support_tickets')
      .update({ status })
      .eq('id', ticketId)
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendTicket(data);
  }

  /* ---------------- Предложения от пользователей ----------------
     public.suggestions + public.suggestion_votes, читаем через вьюху
     suggestions_with_votes (готовое число голосов). Любой залогиненный
     видит все и может проголосовать один раз; статус меняет админ. */

  function toFrontendSuggestion(s, myVotedIds) {
    return {
      id: s.id,
      title: s.title,
      message: s.message,
      status: s.status,
      adminComment: s.admin_comment,
      votes: s.votes_count || 0,
      createdAt: s.created_at,
      userId: s.user_id,
      votedByMe: myVotedIds ? myVotedIds.has(s.id) : false
    };
  }

  async function listSuggestions() {
    const session = await requireSession();
    const [{ data, error }, { data: myVotes, error: voteError }] = await Promise.all([
      client.from('suggestions_with_votes').select('*').order('created_at', { ascending: false }),
      client.from('suggestion_votes').select('suggestion_id').eq('user_id', session.user.id)
    ]);
    if (error) throw friendlyError(error);
    if (voteError) throw friendlyError(voteError);
    const myVotedIds = new Set((myVotes || []).map(v => v.suggestion_id));
    return data.map(s => toFrontendSuggestion(s, myVotedIds));
  }

  async function createSuggestion({ title, message }) {
    const session = await requireSession();
    const { data, error } = await client
      .from('suggestions')
      .insert({ user_id: session.user.id, title, message })
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendSuggestion(data, new Set());
  }

  async function voteSuggestion(suggestionId) {
    const session = await requireSession();
    const { error } = await client
      .from('suggestion_votes')
      .insert({ suggestion_id: suggestionId, user_id: session.user.id });
    if (error) throw friendlyError(error);
  }

  async function unvoteSuggestion(suggestionId) {
    const session = await requireSession();
    const { error } = await client
      .from('suggestion_votes')
      .delete()
      .eq('suggestion_id', suggestionId)
      .eq('user_id', session.user.id);
    if (error) throw friendlyError(error);
  }

  async function adminUpdateSuggestion(suggestionId, patch) {
    await requireSession();
    const row = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.adminComment !== undefined) row.admin_comment = patch.adminComment || null;
    const { data, error } = await client
      .from('suggestions')
      .update(row)
      .eq('id', suggestionId)
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendSuggestion(data, new Set());
  }

  /* ---------------- Пользовательские тесты (с модерацией) ----------------
     public.user_tests (см. supabase/moderator.sql). Автор создаёт тест —
     он попадает на модерацию (status: pending), после чего модератор или
     админ либо публикует его (published, виден всем в теме), либо
     отклоняет (rejected, виден только автору с комментарием). */

  function toFrontendUserTest(t) {
    return {
      id: t.id,
      userId: t.user_id,
      disciplineId: t.discipline_id,
      topicId: t.topic_id,
      title: t.title,
      questions: t.questions,
      status: t.status,
      moderatorComment: t.moderator_comment,
      createdAt: t.created_at,
      authorName: t.author_name,
      authorLevel: t.author_level,
      authorEmail: t.author_email
    };
  }

  async function createUserTest({ disciplineId, topicId, title, questions, authorName, authorLevel }) {
    const session = await requireSession();
    const { data, error } = await client
      .from('user_tests')
      .insert({
        user_id: session.user.id,
        discipline_id: disciplineId,
        topic_id: topicId,
        title,
        questions,
        author_name: authorName || 'Аноним',
        author_level: authorLevel || 1
      })
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendUserTest(data);
  }

  async function listPublishedUserTests() {
    await requireSession();
    const { data, error } = await client
      .from('user_tests')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    if (error) throw friendlyError(error);
    return data.map(toFrontendUserTest);
  }

  async function listMyUserTests() {
    const session = await requireSession();
    const { data, error } = await client
      .from('user_tests')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    if (error) throw friendlyError(error);
    return data.map(toFrontendUserTest);
  }

  async function moderatorListPendingTests() {
    await requireSession();
    const { data, error } = await client
      .from('user_tests_with_author')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw friendlyError(error);
    return data.map(toFrontendUserTest);
  }

  async function moderatorSetTestStatus(testId, status, comment) {
    await requireSession();
    const { data, error } = await client
      .from('user_tests')
      .update({ status, moderator_comment: comment || null, reviewed_at: new Date().toISOString() })
      .eq('id', testId)
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendUserTest(data);
  }

  // Автор может удалить свой тест в любом статусе; модератор/админ — любой
  // (RLS "Users can delete own tests", см. supabase/user-content-delete.sql).
  async function deleteUserTest(testId) {
    await requireSession();
    // RLS на DELETE не даёт явной ошибки доступа — просто удаляет 0 строк,
    // если политика не разрешает. .select() позволяет отличить это от
    // настоящего успеха и показать понятную ошибку вместо тихого "ничего
    // не произошло".
    const { data, error } = await client.from('user_tests').delete().eq('id', testId).select();
    if (error) throw friendlyError(error);
    if (!data || !data.length) throw new Error('Не удалось удалить тест — похоже, не хватает прав.');
  }

  /* ---------------- Пользовательские статьи (с модерацией) ----------------
     public.user_articles (см. supabase/moderator.sql) — та же логика
     pending/published/rejected, что и у пользовательских тестов. */

  function toFrontendUserArticle(a) {
    return {
      id: a.id,
      userId: a.user_id,
      topic: a.topic,
      title: a.title,
      excerpt: a.excerpt,
      body: a.body,
      readTime: a.read_time,
      status: a.status,
      moderatorComment: a.moderator_comment,
      createdAt: a.created_at,
      authorName: a.author_name,
      authorEmail: a.author_email
    };
  }

  async function createUserArticle({ topic, title, excerpt, body, readTime, authorName }) {
    const session = await requireSession();
    const { data, error } = await client
      .from('user_articles')
      .insert({ user_id: session.user.id, topic, title, excerpt, body, read_time: readTime, author_name: authorName || 'Аноним' })
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendUserArticle(data);
  }

  async function listPublishedUserArticles() {
    await requireSession();
    const { data, error } = await client
      .from('user_articles')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    if (error) throw friendlyError(error);
    return data.map(toFrontendUserArticle);
  }

  async function listMyUserArticles() {
    const session = await requireSession();
    const { data, error } = await client
      .from('user_articles')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    if (error) throw friendlyError(error);
    return data.map(toFrontendUserArticle);
  }

  async function moderatorListPendingArticles() {
    await requireSession();
    const { data, error } = await client
      .from('user_articles_with_author')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw friendlyError(error);
    return data.map(toFrontendUserArticle);
  }

  async function moderatorSetArticleStatus(articleId, status, comment) {
    await requireSession();
    const { data, error } = await client
      .from('user_articles')
      .update({ status, moderator_comment: comment || null, reviewed_at: new Date().toISOString() })
      .eq('id', articleId)
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendUserArticle(data);
  }

  async function deleteUserArticle(articleId) {
    await requireSession();
    const { data, error } = await client.from('user_articles').delete().eq('id', articleId).select();
    if (error) throw friendlyError(error);
    if (!data || !data.length) throw new Error('Не удалось удалить статью — похоже, не хватает прав.');
  }

  /* ---------------- Дуэли против реальных игроков (PvP) ----------------
     public.pvp_duels (см. supabase/duels.sql) — открытое лобби: вызов
     создаётся без конкретного соперника, любой другой пользователь может
     его принять. Приём/счёт/пересчёт рейтинга идут через security
     definer RPC (duel_accept_challenge/duel_submit_score) — прямой
     UPDATE по таблице клиенту не даёт ничего изменить, кроме отмены
     своего же ещё не принятого вызова. */

  function toFrontendDuel(d) {
    return {
      id: d.id,
      challengerId: d.challenger_id,
      opponentId: d.opponent_id,
      discipline: d.discipline,
      topic: d.topic,
      questionIds: d.question_ids,
      questionCount: d.question_count,
      status: d.status,
      challengerScore: d.challenger_score,
      opponentScore: d.opponent_score,
      challengerPlayedAt: d.challenger_played_at,
      opponentPlayedAt: d.opponent_played_at,
      winnerId: d.winner_id,
      challengerRatingDelta: d.challenger_rating_delta,
      opponentRatingDelta: d.opponent_rating_delta,
      createdAt: d.created_at,
      completedAt: d.completed_at
    };
  }

  async function createDuelChallenge({ discipline, topic, questionIds, questionCount }) {
    const session = await requireSession();
    const { data, error } = await client
      .from('pvp_duels')
      .insert({
        challenger_id: session.user.id,
        discipline, topic,
        question_ids: questionIds,
        question_count: questionCount
      })
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendDuel(data);
  }

  async function listOpenDuels() {
    await requireSession();
    const { data, error } = await client
      .from('pvp_duels')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    if (error) throw friendlyError(error);
    return data.map(toFrontendDuel);
  }

  async function listMyDuels() {
    const session = await requireSession();
    const { data, error } = await client
      .from('pvp_duels')
      .select('*')
      .or(`challenger_id.eq.${session.user.id},opponent_id.eq.${session.user.id}`)
      .order('created_at', { ascending: false });
    if (error) throw friendlyError(error);
    return data.map(toFrontendDuel);
  }

  async function acceptDuelChallenge(challengeId) {
    await requireSession();
    const { data, error } = await client.rpc('duel_accept_challenge', { p_challenge_id: challengeId });
    if (error) throw friendlyError(error);
    return toFrontendDuel(data);
  }

  async function submitDuelScore(challengeId, score) {
    await requireSession();
    const { data, error } = await client.rpc('duel_submit_score', { p_challenge_id: challengeId, p_score: score });
    if (error) throw friendlyError(error);
    return toFrontendDuel(data);
  }

  async function cancelDuelChallenge(challengeId) {
    const session = await requireSession();
    const { data, error } = await client
      .from('pvp_duels')
      .update({ status: 'cancelled' })
      .eq('id', challengeId)
      .eq('challenger_id', session.user.id)
      .select()
      .single();
    if (error) throw friendlyError(error);
    return toFrontendDuel(data);
  }

  /* ---------------- ИИ-консультант ----------------
     Сам вызов NVIDIA API живёт в Edge Function ai-consultant — ключ
     там, во фронтенде его нет и быть не должно. Функция сама же
     проверяет тариф (только pro/max) и дневной лимit по
     ai_consultant_usage (см. supabase/ai-consultant.sql). */

  async function askAiConsultant(message, history) {
    const session = await requireSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-consultant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ message, history: history || [] })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Не удалось получить ответ от ИИ-консультанта.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    register, login, logout, me, updateProfile, addAiExtraRequests, toFrontendUser,
    adminListUsers, adminUpdateUser, adminGrantCoins, adminGrantSubscription, adminSetBanned, adminSetModerator, adminDeleteUser,
    logAdminAction, adminListAuditLog,
    moderatorGrantCoins,
    createSupportTicket, listMySupportTickets, adminListSupportTickets, adminReplyTicket, adminSetTicketStatus,
    listSuggestions, createSuggestion, voteSuggestion, unvoteSuggestion, adminUpdateSuggestion,
    createUserTest, listPublishedUserTests, listMyUserTests, moderatorListPendingTests, moderatorSetTestStatus, deleteUserTest,
    createUserArticle, listPublishedUserArticles, listMyUserArticles, moderatorListPendingArticles, moderatorSetArticleStatus, deleteUserArticle,
    createDuelChallenge, listOpenDuels, listMyDuels, acceptDuelChallenge, submitDuelScore, cancelDuelChallenge,
    askAiConsultant,
    getClient: () => client
  };
})();
