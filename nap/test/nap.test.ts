import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { napify, NapError, clampScore, countWords, buildShareText, validateInput, NapResult } from '../src/nap';
import { createServer, renderSharePage } from '../src/server';
import { renderCard } from '../src/cli';

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
    expect(s).toContain('"Could have been a text."');
  });
});

describe('napify', () => {
  it('normalises model output into a result', async () => {
    const r = await napify(LONG, { client: fakeClient(GOOD) });
    expect(r.napScore).toBe(87);
    expect(r.needToKnow).toEqual(['Deadline is Wednesday noon', 'Fridge gets cleaned Thursday', 'extra']);
    expect(r.action).toMatch(/Wednesday/);
    expect(r.stats.words).toBe(countWords(LONG));
    expect(r.stats.readSeconds).toBeGreaterThan(0);
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

const RESULT: NapResult = {
  tldr: 'Deadline moved to Wednesday.',
  needToKnow: ['Wednesday noon', '<b>fridge</b> cleaned Thursday'],
  action: 'Upload your section.',
  napScore: 87,
  verdict: 'A "quick" update.',
  stats: { words: 300, readSeconds: 76, savedSeconds: 58 },
  share: 'I just napped through 300 words. 87% nappable.\n\n"A "quick" update."\n\n#nap',
};

describe('server', () => {
  async function withServer(fn: (base: string) => Promise<void>, nap = async () => RESULT) {
    const server = createServer({ nap, rateLimitPerMinute: 3 });
    await new Promise<void>((res) => server.listen(0, res));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  }

  it('serves the page and health check', () =>
    withServer(async (base) => {
      const page = await fetch(base + '/');
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<title>nap</title>');
      const health = await fetch(base + '/healthz');
      expect(await health.json()).toEqual({ ok: true, zzz: true });
    }));

  it('naps text and serves a share page', () =>
    withServer(async (base) => {
      const res = await fetch(base + '/api/nap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: LONG }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as NapResult & { id: string; url: string };
      expect(body.napScore).toBe(87);
      expect(body.url).toMatch(/\/n\/[A-Za-z0-9_-]{8}$/);

      const share = await fetch(body.url);
      expect(share.status).toBe(200);
      const htmlText = await share.text();
      expect(htmlText).toContain('87%');
      expect(htmlText).toContain('&lt;b&gt;fridge&lt;/b&gt;');
      expect(htmlText).toContain('og:title');

      const api = await fetch(base + '/api/nap/' + body.id);
      expect(((await api.json()) as NapResult).tldr).toBe(RESULT.tldr);
    }));

  it('rejects bad bodies and unknown naps', () =>
    withServer(async (base) => {
      const bad = await fetch(base + '/api/nap', { method: 'POST', body: 'not json' });
      expect(bad.status).toBe(400);
      const wrongType = await fetch(base + '/api/nap', { method: 'POST', body: JSON.stringify({ text: 42 }) });
      expect(wrongType.status).toBe(400);
      const missing = await fetch(base + '/n/zzzzzzzz');
      expect(missing.status).toBe(404);
    }));

  it('rate limits per ip', () =>
    withServer(async (base) => {
      const post = () => fetch(base + '/api/nap', { method: 'POST', body: JSON.stringify({ text: LONG }) });
      for (let i = 0; i < 3; i++) expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(429);
    }));

  it('maps NapError status codes from the nap function', () =>
    withServer(
      async (base) => {
        const res = await fetch(base + '/api/nap', { method: 'POST', body: JSON.stringify({ text: LONG }) });
        expect(res.status).toBe(422);
        expect(((await res.json()) as { error: string }).error).toMatch(/rather not/);
      },
      async () => {
        throw new NapError('nap would rather not read that one.', 422);
      },
    ));
});

describe('renderers', () => {
  it('escapes html in the share page', () => {
    const page = renderSharePage('abcdefgh', RESULT, 'https://nap.example');
    expect(page).not.toContain('<b>fridge</b>');
    expect(page).toContain('https://nap.example/n/abcdefgh');
  });

  it('renders a cli card', () => {
    const card = renderCard(RESULT);
    expect(card).toContain('87% nappable');
    expect(card).toContain('• Wednesday noon');
    expect(card).toContain('do this  Upload your section.');
  });
});
