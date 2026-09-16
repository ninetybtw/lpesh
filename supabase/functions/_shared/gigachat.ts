// LexPrep — общий клиент GigaChat API для ai-consultant и ai-consultant-pro.
//
// Один и тот же ключ (секрет GIGACHAT_AUTH_KEY — это "Authorization key"
// из личного кабинета GigaChat API, строка client_id:client_secret в
// base64) используется в обеих функциях. GigaChat выдаёт access_token не
// напрямую по этому ключу, а через отдельный OAuth-обмен — токен живёт
// около 30 минут, поэтому кэшируем его в памяти модуля между вызовами (в
// рамках одного тёплого инстанса edge-функции), чтобы не ходить за новым
// токеном на каждое сообщение.

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const CHAT_URL = 'https://api.giga.chat/v1/chat/completions';

let cachedToken: { value: string; expiresAt: number } | null = null;

async function fetchAccessToken(authKey: string, scope: string): Promise<{ value: string; expiresAt: number }> {
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: `Basic ${authKey}`
    },
    body: `scope=${encodeURIComponent(scope)}`
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GigaChat OAuth error (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('GigaChat OAuth: пустой access_token в ответе');
  // expires_at у GigaChat — unix-время в миллисекундах; на всякий случай
  // считаем токен просроченным на минуту раньше заявленного срока.
  const expiresAt = typeof data.expires_at === 'number' ? data.expires_at - 60_000 : Date.now() + 25 * 60_000;
  return { value: data.access_token, expiresAt };
}

async function getAccessToken(authKey: string, scope: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  cachedToken = await fetchAccessToken(authKey, scope);
  return cachedToken.value;
}

export async function callGigaChat(opts: {
  authKey: string;
  scope: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const token = await getAccessToken(opts.authKey, opts.scope);

  const doCall = (accessToken: string) => fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 700
    })
  });

  let res = await doCall(token);
  if (res.status === 401) {
    // Токен мог протухнуть раньше заявленного срока — получаем новый и
    // пробуем один раз ещё, прежде чем сдаться.
    cachedToken = null;
    const freshToken = await getAccessToken(opts.authKey, opts.scope);
    res = await doCall(freshToken);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GigaChat API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('Пустой ответ от ИИ — попробуй переформулировать вопрос.');
  return reply;
}
