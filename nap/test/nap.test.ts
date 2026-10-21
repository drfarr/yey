import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { napify, NapError, clampScore, countWords, buildShareText, validateInput, NapResult } from '../src/nap';
import { MemoryStore } from '../src/store';
import { newId, isValidId } from '../src/ids';
import { createHandlers, parseText, ipFrom, originFrom } from '../src/handlers';
import { renderSharePage, savedLabel } from '../src/render';
import { ogElement } from '../src/og';
import { renderIndex } from '../src/page';
import { createServer } from '../src/server';
import { renderCard } from '../src/cli';
import napFn from '../api/nap';
import napByIdFn from '../api/nap/[id]';
import shareFn from '../api/n/[id]';
import ogFn from '../api/og';

const LONG = 'Hi team, hope everyone had a restful weekend. '.repeat(8);

function fakeClient(output: unknown, stop_reason = 'end_turn'): Anthropic {
  return {
    messages: {
      parse: async () => ({ stop_reason, parsed_output: output }),
    },
  } as unknown as Anthropic;
}

const GOOD = {
  tldr: 'The report deadline moved to Wednesday noon.',
  need_to_know: ['  Deadline is Wednesday noon ', '', 'Fridge gets cleaned Thursday', 'extra', 'more'],
  action: 'Put your section in the shared folder by Wednesday noon.',
  nap_score: 87.4,
  verdict: 'Four paragraphs of warm-up for one sentence.',
};

const RESULT: NapResult = {
  tldr: 'Deadline moved to Wednesday.',
  needToKnow: ['Wednesday noon', '<b>fridge</b> cleaned Thursday'],
  action: 'Upload your section.',
  napScore: 87,
  verdict: 'A "quick" update.',
  stats: { words: 300, readSeconds: 76, savedSeconds: 58 },
  share: 'I just napped through 300 words. 87% nappable.\n\n"A "quick" update."\n\n#nap',
};

const okNap = async () => RESULT;

describe('helpers', () => {
  it('counts words', () => {
    expect(countWords('  one two\nthree  ')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  it('clamps and rounds scores', () => {
    expect(clampScore(87.4)).toBe(87);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(NaN)).toBe(50);
  });

  it('rejects input that is too short or too long', () => {
    expect(() => validateInput('hi')).toThrow(NapError);
    expect(() => validateInput('x'.repeat(60_001))).toThrow(/novel/);
    expect(validateInput(`  ${LONG}  `)).toBe(LONG.trim());
  });

  it('builds share text', () => {
    const s = buildShareText({ napScore: 91, verdict: 'Could have been a text.', words: 1200 });
    expect(s).toContain('1,200 words');
    expect(s).toContain('91% nappable');
  });

  it('makes and validates ids', () => {
    const id = newId();
    expect(isValidId(id)).toBe(true);
    expect(new Set(Array.from({ length: 50 }, newId)).size).toBe(50);
    expect(isValidId('short')).toBe(false);
    expect(isValidId('../../..')).toBe(false);
    expect(isValidId(undefined)).toBe(false);
  });

  it('parses request bodies in every shape vercel hands over', () => {
    expect(parseText({ text: 'a' })).toBe('a');
    expect(parseText('{"text":"b"}')).toBe('b');
    expect(parseText('plain words')).toBe('plain words');
    expect(parseText(new TextEncoder().encode('{"text":"c"}'))).toBe('c');
    expect(() => parseText({ text: 1 })).toThrow(NapError);
    expect(() => parseText(undefined)).toThrow(NapError);
  });

  it('derives ip and origin from proxy headers', () => {
    expect(ipFrom('1.2.3.4, 10.0.0.1', '::1')).toBe('1.2.3.4');
    expect(ipFrom(undefined, '::1')).toBe('::1');
    expect(originFrom('nap.app', 'https')).toBe('https://nap.app');
    expect(originFrom(undefined, undefined)).toBe('http://localhost');
  });

  it('labels saved time', () => {
    expect(savedLabel(58)).toBe('58 sec saved');
    expect(savedLabel(240)).toBe('4 min saved');
  });
});

describe('napify', () => {
  it('normalises model output into a result', async () => {
    const r = await napify(LONG, { client: fakeClient(GOOD) });
    expect(r.napScore).toBe(87);
    expect(r.needToKnow).toEqual(['Deadline is Wednesday noon', 'Fridge gets cleaned Thursday', 'extra']);
    expect(r.stats.words).toBe(countWords(LONG));
    expect(r.stats.savedSeconds).toBeLessThanOrEqual(r.stats.readSeconds);
    expect(r.share).toContain('87% nappable');
  });

  it('surfaces refusals as a NapError', async () => {
    await expect(napify(LONG, { client: fakeClient(GOOD, 'refusal') })).rejects.toMatchObject({ status: 422 });
  });

  it('fails cleanly when nothing parsed', async () => {
    await expect(napify(LONG, { client: fakeClient(null) })).rejects.toMatchObject({ status: 502 });
  });

  it('does not call the model for bad input', async () => {
    let called = false;
    const client = { messages: { parse: async () => { called = true; return {}; } } } as unknown as Anthropic;
    await expect(napify('short', { client })).rejects.toThrow(NapError);
    expect(called).toBe(false);
  });
});

describe('MemoryStore', () => {
  it('stores with ttl and evicts oldest', async () => {
    let t = 1_000_000;
    const s = new MemoryStore(2, () => t);
    await s.set('a', RESULT, 10);
    await s.set('b', RESULT, 10);
    await s.set('c', RESULT, 10);
    expect(await s.get('a')).toBeNull();
    expect(await s.get('c')).toEqual(RESULT);
    t += 11_000;
    expect(await s.get('c')).toBeNull();
  });

  it('counts within a window and resets after', async () => {
    let t = 0;
    const s = new MemoryStore(10, () => t);
    expect(await s.incr('k', 60)).toBe(1);
    expect(await s.incr('k', 60)).toBe(2);
    t = 61_000;
    expect(await s.incr('k', 60)).toBe(1);
  });
});

describe('handlers', () => {
  it('creates, fetches and renders a nap', async () => {
    const store = new MemoryStore();
    const h = createHandlers({ nap: okNap, store, perMinute: 5, perDay: 5 });
    const created = await h.createNap({ text: LONG }, '1.1.1.1', 'https://nap.app');
    expect(created.status).toBe(200);
    const body = JSON.parse(created.body);
    expect(body.url).toBe(`https://nap.app/n/${body.id}`);
    expect(body.image).toBe(`https://nap.app/api/og?id=${body.id}`);
    expect(body.napScore).toBe(87);

    const got = await h.getNap(body.id);
    expect(JSON.parse(got.body).tldr).toBe(RESULT.tldr);

    const page = await h.sharePage(body.id, 'https://nap.app');
    expect(page.status).toBe(200);
    expect(page.body).toContain('&lt;b&gt;fridge&lt;/b&gt;');
    expect(page.body).toContain(`https://nap.app/api/og?id=${body.id}`);
    expect(page.body).toContain('summary_large_image');

    expect((await h.getNap('nope')).status).toBe(404);
    expect((await h.sharePage('zzzzzzzz', 'x')).status).toBe(404);
  });

  it('rate limits per minute and per day', async () => {
    let t = Date.UTC(2026, 0, 1);
    const store = new MemoryStore(100, () => t);
    const h = createHandlers({ nap: okNap, store, perMinute: 2, perDay: 3, now: () => t });
    const go = () => h.createNap({ text: LONG }, '9.9.9.9', 'o');
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(429);
    t += 61_000;
    expect((await go()).status).toBe(200);
    const day = await go();
    expect(day.status).toBe(429);
    expect(JSON.parse(day.body).error).toMatch(/tomorrow/);
    expect((await h.createNap({ text: LONG }, '8.8.8.8', 'o')).status).toBe(200);
  });

  it('maps errors to statuses', async () => {
    const h = createHandlers({
      store: new MemoryStore(),
      nap: async () => {
        throw new NapError('nap would rather not read that one.', 422);
      },
    });
    const r = await h.createNap({ text: LONG }, 'ip', 'o');
    expect(r.status).toBe(422);
    const bad = await h.createNap({ text: 7 }, 'ip', 'o');
    expect(bad.status).toBe(400);
  });
});

describe('renderers', () => {
  it('escapes html in the share page', () => {
    const page = renderSharePage('abcdefgh', RESULT, 'https://nap.example');
    expect(page).not.toContain('<b>fridge</b>');
    expect(page).toContain('https://nap.example/n/abcdefgh');
  });

  it('fills the public url into the landing page', () => {
    const page = renderIndex('https://nap.app/');
    expect(page).toContain('content="https://nap.app/api/og"');
    expect(page).not.toContain('__PUBLIC_URL__');
  });

  it('renders a cli card', () => {
    const card = renderCard(RESULT);
    expect(card).toContain('87% nappable');
    expect(card).toContain('• Wednesday noon');
  });

  it('builds a satori tree where every multi-child node is flex', () => {
    const check = (n: unknown): void => {
      if (!n || typeof n !== 'object' || !('props' in n)) return;
      const node = n as { props: { style?: Record<string, unknown>; children?: unknown } };
      const kids = node.props.children;
      if (Array.isArray(kids)) {
        expect(node.props.style?.display).toBe('flex');
        kids.forEach(check);
      } else check(kids);
    };
    check(ogElement(RESULT, 'nap.app'));
    check(ogElement(null, 'nap.app'));
  });
});

describe('vercel functions', () => {
  function fakeReqRes(init: { method?: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string> }) {
    const headers: Record<string, string> = {};
    let status = 0;
    let sent = '';
    const req = {
      method: init.method ?? 'GET',
      body: init.body,
      query: init.query ?? {},
      headers: { host: 'nap.app', 'x-forwarded-proto': 'https', ...(init.headers ?? {}) },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = {
      status(s: number) { status = s; return res; },
      setHeader(k: string, v: string) { headers[k] = v; },
      send(b: string) { sent = b; },
    };
    return { req, res, result: () => ({ status, headers, body: sent }) };
  }

  it('rejects non-POST on /api/nap and serves 404s by id', async () => {
    const a = fakeReqRes({ method: 'GET' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await napFn(a.req as any, a.res as any);
    expect(a.result().status).toBe(405);

    const b = fakeReqRes({ query: { id: 'zzzzzzzz' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await napByIdFn(b.req as any, b.res as any);
    expect(b.result().status).toBe(404);

    const c = fakeReqRes({ query: { id: 'zzzzzzzz' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await shareFn(c.req as any, c.res as any);
    expect(c.result().status).toBe(404);
    expect(c.result().headers['content-type']).toContain('text/html');
  });

  it('renders the generic og card as a png', async () => {
    const res = await ogFn(new Request('https://nap.app/api/og'));
    expect(res.headers.get('content-type')).toContain('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);
});

describe('dev server', () => {
  async function withServer(fn: (base: string) => Promise<void>) {
    const server = createServer({ nap: okNap, store: new MemoryStore(), perMinute: 3, perDay: 10 });
    await new Promise<void>((res) => server.listen(0, res));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  }

  it('serves the page, naps, share page and card image', () =>
    withServer(async (base) => {
      const page = await fetch(base + '/');
      expect(page.status).toBe(200);
      expect(await page.text()).toContain(`content="${base}/api/og"`);

      const res = await fetch(base + '/api/nap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: LONG }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as NapResult & { id: string; url: string; image: string };
      expect(body.url).toMatch(/\/n\/[A-Za-z0-9_-]{8}$/);

      const share = await fetch(body.url);
      expect(share.status).toBe(200);
      expect(await share.text()).toContain('87%');

      const img = await fetch(body.image);
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/png');
      expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(1000);

      const bad = await fetch(base + '/api/nap', { method: 'POST', body: JSON.stringify({ text: 42 }) });
      expect(bad.status).toBe(400);
      expect((await fetch(base + '/n/zzzzzzzz')).status).toBe(404);
    }), 30_000);
});
