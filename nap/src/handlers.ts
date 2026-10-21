import { napify, NapError, NapResult } from './nap';
import { getStore, Store } from './store';
import { newId, isValidId } from './ids';
import { renderSharePage, renderNotFound } from './render';

export type NapFn = (text: string) => Promise<NapResult>;

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HandlerDeps {
  nap?: NapFn;
  store?: Store;
  perMinute?: number;
  perDay?: number;
  ttlSeconds?: number;
  now?: () => number;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };

export function json(status: number, body: unknown): HttpResult {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function html(status: number, body: string, extra: Record<string, string> = {}): HttpResult {
  return { status, headers: { ...HTML_HEADERS, ...extra }, body };
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Accepts a parsed JSON object, a JSON string, or a raw text body. */
export function parseText(body: unknown): string {
  if (body && typeof body === 'object' && 'text' in body) {
    const t = (body as { text: unknown }).text;
    if (typeof t !== 'string') throw new NapError('"text" must be a string.', 400);
    return t;
  }
  if (typeof body === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return body; // not JSON: the body itself is the text
    }
    if (parsed && typeof parsed === 'object') return parseText(parsed);
    return body;
  }
  if (body instanceof Uint8Array) return parseText(new TextDecoder().decode(body));
  throw new NapError('Send JSON like {"text": "..."}.', 400);
}

export function ipFrom(forwardedFor: string | string[] | undefined, fallback?: string | null): string {
  const first = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return first?.split(',')[0]?.trim() || fallback || 'unknown';
}

export function originFrom(host: string | undefined, proto: string | string[] | undefined): string {
  const p = Array.isArray(proto) ? proto[0] : proto;
  return `${p?.split(',')[0]?.trim() || 'http'}://${host || 'localhost'}`;
}

export function createHandlers(deps: HandlerDeps = {}) {
  const nap = deps.nap ?? ((t: string) => napify(t));
  const store = deps.store ?? getStore();
  const perMinute = deps.perMinute ?? envInt('NAP_LIMIT_PER_MINUTE', 10);
  const perDay = deps.perDay ?? envInt('NAP_LIMIT_PER_DAY', 40);
  const ttl = deps.ttlSeconds ?? 60 * 60 * 24 * 30;
  const now = deps.now ?? Date.now;

  async function enforceLimits(ip: string): Promise<void> {
    const t = now();
    const minuteKey = `${ip}:m:${Math.floor(t / 60_000)}`;
    const dayKey = `${ip}:d:${new Date(t).toISOString().slice(0, 10)}`;
    if ((await store.incr(minuteKey, 60)) > perMinute) {
      throw new NapError('Slow down. Even nap needs a nap. Try again in a minute.', 429);
    }
    if ((await store.incr(dayKey, 86_400)) > perDay) {
      throw new NapError("That's a lot of napping for one day. Come back tomorrow.", 429);
    }
  }

  function fail(err: unknown): HttpResult {
    if (err instanceof NapError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: 'nap fell out of bed. Try again.' });
  }

  return {
    async createNap(rawBody: unknown, ip: string, origin: string): Promise<HttpResult> {
      try {
        const text = parseText(rawBody);
        await enforceLimits(ip);
        const result = await nap(text);
        const id = newId();
        await store.set(id, result, ttl);
        return json(200, { id, url: `${origin}/n/${id}`, image: `${origin}/api/og?id=${id}`, ...result });
      } catch (err) {
        return fail(err);
      }
    },

    async getNap(id: unknown): Promise<HttpResult> {
      try {
        if (!isValidId(id)) return json(404, { error: 'not found' });
        const r = await store.get(id);
        if (!r) return json(404, { error: 'not found' });
        return json(200, { id, ...r });
      } catch (err) {
        return fail(err);
      }
    },

    async sharePage(id: unknown, origin: string): Promise<HttpResult> {
      try {
        if (!isValidId(id)) return html(404, renderNotFound());
        const r = await store.get(id);
        if (!r) return html(404, renderNotFound());
        return html(200, renderSharePage(id, r, origin), { 'cache-control': 'public, max-age=300' });
      } catch (err) {
        console.error(err);
        return html(500, renderNotFound());
      }
    },
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
