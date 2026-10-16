// LexPrep — поиск в интернете для ИИ-консультанта (инструмент web_search,
// который GigaChat вызывает сам через function calling, см. gigachat.ts).
//
// Источник выбирается по переменным окружения контейнера функций:
//   YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID — Yandex Search API
//     (Яндекс Облако): обычный поиск по интернету, с законами, практикой и
//     новостями. Это рекомендуемый вариант.
//   без них — поиск по русской Википедии: работает сразу и бесплатно, но
//     годится только для понятий и истории, не для свежих изменений.

export type SearchResult = { title: string; url: string; snippet: string };

const UA = 'LexPrepBot/1.0 (https://lexprep.ru; study assistant)';

function withTimeout(ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(id) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

async function yandexSearch(query: string, apiKey: string, folderId: string): Promise<SearchResult[]> {
  const t = withTimeout(10_000);
  try {
    const res = await fetch('https://searchapi.api.cloud.yandex.net/v2/web/search', {
      method: 'POST',
      headers: { Authorization: `Api-Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { searchType: 'SEARCH_TYPE_RU', queryText: query },
        groupSpec: { groupMode: 'GROUP_MODE_DEEP', groupsOnPage: '6', docsInGroup: '1' },
        maxPassages: '3',
        region: '225',
        l10N: 'LOCALIZATION_RU',
        folderId,
        responseFormat: 'FORMAT_XML'
      }),
      signal: t.signal
    });
    if (!res.ok) throw new Error(`Yandex Search API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const xml = base64ToUtf8(json.rawData || '');
    const results: SearchResult[] = [];
    for (const doc of xml.match(/<doc\b[\s\S]*?<\/doc>/g) || []) {
      const url = decodeEntities((doc.match(/<url>([\s\S]*?)<\/url>/) || [])[1] || '');
      const title = decodeEntities((doc.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
      const passages = (doc.match(/<passage>([\s\S]*?)<\/passage>/g) || []).map(p => decodeEntities(p)).join(' … ');
      const headline = decodeEntities((doc.match(/<headline>([\s\S]*?)<\/headline>/) || [])[1] || '');
      if (url) results.push({ title, url, snippet: (passages || headline).slice(0, 700) });
    }
    return results.slice(0, 6);
  } finally {
    t.done();
  }
}

async function wikipediaSearch(query: string): Promise<SearchResult[]> {
  const t = withTimeout(8_000);
  try {
    const searchUrl = 'https://ru.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=4&srsearch='
      + encodeURIComponent(query);
    const res = await fetch(searchUrl, { headers: { 'User-Agent': UA }, signal: t.signal });
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    const data = await res.json();
    const hits: Array<{ title: string; snippet: string }> = data?.query?.search || [];
    if (!hits.length) return [];

    // Короткие выдержки из начала статей — по ним модели проще ответить.
    const titles = hits.map(h => h.title).join('|');
    const extractsUrl = 'https://ru.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exchars=900&format=json&utf8=1&titles='
      + encodeURIComponent(titles);
    let extracts: Record<string, string> = {};
    try {
      const er = await fetch(extractsUrl, { headers: { 'User-Agent': UA }, signal: t.signal });
      const ed = await er.json();
      for (const page of Object.values(ed?.query?.pages || {}) as Array<{ title: string; extract?: string }>) {
        if (page.extract) extracts[page.title] = page.extract;
      }
    } catch (_) {
      extracts = {};
    }

    return hits.map(h => ({
      title: h.title,
      url: `https://ru.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
      snippet: (extracts[h.title] || decodeEntities(h.snippet)).slice(0, 900)
    }));
  } finally {
    t.done();
  }
}

export async function webSearch(query: string): Promise<{ provider: string; results: SearchResult[] }> {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) return { provider: 'none', results: [] };
  const apiKey = Deno.env.get('YANDEX_SEARCH_API_KEY');
  const folderId = Deno.env.get('YANDEX_SEARCH_FOLDER_ID');
  if (apiKey && folderId) {
    try {
      return { provider: 'yandex', results: await yandexSearch(q, apiKey, folderId) };
    } catch (e) {
      console.error('[websearch] Yandex Search API не ответил, ищем в Википедии:', e?.message);
    }
  }
  try {
    return { provider: 'wikipedia', results: await wikipediaSearch(q) };
  } catch (e) {
    console.error('[websearch] Википедия не ответила:', e?.message);
    return { provider: 'none', results: [] };
  }
}

// Описание инструмента для GigaChat (function calling, см. gigachat.ts).
export function webSearchTool() {
  return {
    name: 'web_search',
    description: 'Поиск в интернете. Используй, когда вопрос касается действующей редакции закона, недавних изменений законодательства, свежей судебной практики, новостей, дат, номеров и реквизитов актов или когда ты не уверен в фактах.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Короткий поисковый запрос на русском языке' }
      },
      required: ['query']
    },
    run: async (args: Record<string, unknown>) => {
      const found = await webSearch(String(args.query || ''));
      return {
        provider: found.provider,
        results: found.results.length ? found.results : 'Ничего не найдено'
      };
    }
  };
}

export const WEB_SEARCH_PROMPT = 'У тебя есть инструмент web_search — поиск в интернете. Вызывай его, когда вопрос касается действующей редакции закона, недавних изменений, свежей судебной практики, новостей, дат, номеров и реквизитов актов, или когда ты не уверен в фактах; на общие учебные вопросы отвечай сам, без поиска. Если пользовался поиском — опирайся на найденное, не выдумывай, и в конце ответа перечисли использованные источники, каждый с новой строки в виде «Источник: название — ссылка». Если поиск ничего полезного не дал — так и скажи.';
