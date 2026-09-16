// LexPrep — общий клиент GigaChat API для ai-consultant и ai-consultant-pro.
//
// ngw.devices.sberbank.ru использует российский корневой сертификат
// (Минцифры), которого нет в стандартном доверенном хранилище —
// edge-runtime (это специализированный урезанный Deno-рантайм, а не
// полноценный Deno CLI) не даёт добавить свой доверенный сертификат ни
// через переменную окружения DENO_CERT, ни через
// Deno.createHttpClient({ caCerts }) — оба варианта молча не работают.
// Обходной путь: локальный Nginx-прокси на этом же сервере (сервис
// gigachat-proxy в docker-compose.yml, см. gigachat-proxy.conf) — у него
// полный контроль над доверенными сертификатами, а наша функция
// обращается к нему уже по простому HTTP внутри докер-сети, как и
// остальные сервисы Supabase друг к другу (см. SUPABASE_URL: http://api-gw:8000).
const OAUTH_URL = 'http://gigachat-proxy:8080/oauth';
const CHAT_URL = 'http://gigachat-proxy:8080/chat';

let cachedToken: { value: string; expiresAt: number } | null = null;

async function fetchAccessToken(authKey: string, scope: string): Promise<{ value: string; expiresAt: number }> {
  const startedAt = Date.now();
  console.log('[gigachat] fetchAccessToken: старт запроса к', OAUTH_URL);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  let res: Response;
  try {
    res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        RqUID: crypto.randomUUID(),
        Authorization: `Basic ${authKey}`
      },
      body: `scope=${encodeURIComponent(scope)}`,
      signal: controller.signal
    });
  } catch (e) {
    console.error('[gigachat] fetchAccessToken: fetch упал через', Date.now() - startedAt, 'мс —', e?.name, e?.message);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  console.log('[gigachat] fetchAccessToken: ответ получен через', Date.now() - startedAt, 'мс, статус', res.status);

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

  const doCall = async (accessToken: string) => {
    const startedAt = Date.now();
    console.log('[gigachat] callGigaChat: старт запроса к', CHAT_URL);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);
    try {
      const r = await fetch(CHAT_URL, {
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
        }),
        signal: controller.signal
      });
      console.log('[gigachat] callGigaChat: ответ получен через', Date.now() - startedAt, 'мс, статус', r.status);
      return r;
    } catch (e) {
      console.error('[gigachat] callGigaChat: fetch упал через', Date.now() - startedAt, 'мс —', e?.name, e?.message);
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  };

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
