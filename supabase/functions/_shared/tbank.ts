// LexPrep — общий клиент API Т-Кассы (Т-Банк, бывший Тинькофф Эквайринг)
// для payments-init/payments-notification/payments-autocharge.
//
// Документация: https://www.tbank.ru/kassa/dev/payments/
// Все запросы подписываются Token'ом: берём ВСЕ корневые параметры запроса
// (кроме вложенных объектов/массивов вроде DATA/Receipt и кроме самого
// Token), добавляем Password терминала, сортируем по ключу, склеиваем
// ЗНАЧЕНИЯ (не ключи) в одну строку и берём от неё SHA-256 (hex,
// нижний регистр). Уведомления от банка подписаны тем же алгоритмом —
// сверяем Token из тела запроса с посчитанным самим.

const API_BASE = 'https://securepay.tinkoff.ru/v2';

// Копейки — совпадают с ценами на index.html#pricing. Общие для
// payments-init (первая оплата) и payments-autocharge (продление), чтобы
// цифры не могли разъехаться между двумя функциями.
export const PRICES_KOPECKS: Record<string, Record<string, number>> = {
  pro: { monthly: 60000, annual: 504000 },
  max: { monthly: 100000, annual: 960000 }
};
export const TIER_TITLES: Record<string, string> = { pro: 'Про', max: 'Максимум' };
export const PERIOD_TITLES: Record<string, string> = { monthly: 'помесячная', annual: 'годовая' };
export const PERIOD_DAYS: Record<string, number> = { monthly: 30, annual: 365 };

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Значения только "плоских" типов (string/number/boolean) участвуют в
// подписи — вложенные объекты/массивы (DATA, Receipt) из неё исключаются,
// таково требование протокола.
function isFlatValue(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

export async function buildToken(params: Record<string, unknown>, password: string): Promise<string> {
  const withPassword: Record<string, unknown> = { ...params, Password: password };
  const keys = Object.keys(withPassword)
    .filter(k => k !== 'Token' && isFlatValue(withPassword[k]))
    .sort();
  const concatenated = keys.map(k => String(withPassword[k])).join('');
  return sha256Hex(concatenated);
}

export async function verifyNotificationToken(payload: Record<string, unknown>, password: string): Promise<boolean> {
  const receivedToken = String(payload.Token || '');
  if (!receivedToken) return false;
  const expected = await buildToken(payload, password);
  return expected === receivedToken;
}

async function callTBank(method: string, terminalKey: string, password: string, params: Record<string, unknown>) {
  const body = { TerminalKey: terminalKey, ...params };
  const token = await buildToken(body, password);
  const startedAt = Date.now();
  console.log(`[tbank] ${method}: старт запроса`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, Token: token }),
      signal: controller.signal
    });
  } catch (e) {
    console.error(`[tbank] ${method}: fetch упал через`, Date.now() - startedAt, 'мс —', e?.name, e?.message);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json();
  console.log(`[tbank] ${method}: ответ получен через`, Date.now() - startedAt, 'мс, Success=', data.Success, 'Status=', data.Status);
  return data;
}

export interface TBankReceiptItem {
  Name: string;
  Price: number; // копейки
  Quantity: number;
  Amount: number; // Price * Quantity, копейки
  Tax: string; // 'none' | 'vat0' | 'vat10' | 'vat20' | 'vat110' | 'vat120'
}

export interface InitParams {
  terminalKey: string;
  password: string;
  amountKopecks: number;
  orderId: string;
  description: string;
  customerKey: string;
  recurrent?: boolean;
  notificationUrl: string;
  successUrl: string;
  failUrl: string;
  receiptEmail: string;
  receiptTaxation: string;
  receiptItem: TBankReceiptItem;
}

export async function tbankInit(p: InitParams) {
  return callTBank('Init', p.terminalKey, p.password, {
    Amount: p.amountKopecks,
    OrderId: p.orderId,
    Description: p.description,
    CustomerKey: p.customerKey,
    ...(p.recurrent ? { Recurrent: 'Y' } : {}),
    NotificationURL: p.notificationUrl,
    SuccessURL: p.successUrl,
    FailURL: p.failUrl,
    Receipt: {
      Email: p.receiptEmail,
      Taxation: p.receiptTaxation,
      Items: [p.receiptItem]
    }
  });
}

export async function tbankCharge(opts: { terminalKey: string; password: string; paymentId: string; rebillId: string }) {
  return callTBank('Charge', opts.terminalKey, opts.password, {
    PaymentId: opts.paymentId,
    RebillId: opts.rebillId
  });
}

export async function tbankGetState(opts: { terminalKey: string; password: string; paymentId: string }) {
  return callTBank('GetState', opts.terminalKey, opts.password, { PaymentId: opts.paymentId });
}
