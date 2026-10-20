import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { napify, NapError, NapResult, MAX_CHARS } from './nap';

type NapFn = (text: string) => Promise<NapResult>;

export interface ServerOptions {
  nap?: NapFn;
  maxStored?: number;
  rateLimitPerMinute?: number;
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function html(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new NapError('Body too large.', 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function renderSharePage(id: string, r: NapResult, origin: string): string {
  const title = `${r.napScore}% nappable: ${r.verdict}`;
  const bullets = r.needToKnow.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · nap</title>
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(r.tldr)}">
<meta property="og:url" content="${escapeHtml(origin)}/n/${id}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(r.tldr)}">
<style>
:root{color-scheme:dark}body{margin:0;background:#0b0b10;color:#f2f1ec;font:17px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:620px;margin:0 auto;padding:48px 16px 80px}
.score{font-size:88px;font-weight:800;letter-spacing:-.04em;line-height:1}
.score small{font-size:22px;font-weight:600;opacity:.6;margin-left:6px}
.verdict{font-size:26px;font-weight:700;margin:12px 0 28px}
h3{font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.5;margin:24px 0 6px}
ul{padding-left:20px;margin:0}li{margin:6px 0}
.pill{display:inline-block;background:#1b1b24;padding:6px 12px;border-radius:999px;font-size:14px;opacity:.85;margin-top:28px}
a.cta{display:block;margin-top:40px;padding:16px;border-radius:14px;background:#f2f1ec;color:#0b0b10;text-decoration:none;text-align:center;font-weight:700;font-size:18px}
</style></head><body><main>
<div class="score">${r.napScore}%<small>nappable</small></div>
<div class="verdict">“${escapeHtml(r.verdict)}”</div>
<h3>tl;dr</h3><p>${escapeHtml(r.tldr)}</p>
${r.needToKnow.length ? `<h3>need to know</h3><ul>${bullets}</ul>` : ''}
<h3>do this</h3><p>${escapeHtml(r.action)}</p>
<span class="pill">${r.stats.words.toLocaleString()} words · ${Math.round(r.stats.savedSeconds / 60)} min saved</span>
<a class="cta" href="/">nap through your own →</a>
</main></body></html>`;
}

export function createServer(opts: ServerOptions = {}): http.Server {
  const nap = opts.nap ?? ((t: string) => napify(t));
  const maxStored = opts.maxStored ?? 1000;
  const limitPerMinute = opts.rateLimitPerMinute ?? 20;

  const store = new Map<string, NapResult>();
  const hits = new Map<string, { count: number; reset: number }>();

  function remember(r: NapResult): string {
    const id = randomBytes(6).toString('base64url');
    store.set(id, r);
    if (store.size > maxStored) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    return id;
  }

  function limited(ip: string): boolean {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) {
      hits.set(ip, { count: 1, reset: now + 60_000 });
      return false;
    }
    h.count += 1;
    return h.count > limitPerMinute;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const origin = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host ?? 'localhost'}`;

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return html(res, 200, INDEX_HTML);
      }

      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true, zzz: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/nap') {
        if (limited(ip)) throw new NapError('Slow down. Even nap needs a nap.', 429);
        const raw = await readBody(req, MAX_CHARS * 4 + 1024);
        let text: unknown;
        try {
          text = JSON.parse(raw).text;
        } catch {
          throw new NapError('Send JSON like {"text": "..."}.', 400);
        }
        if (typeof text !== 'string') throw new NapError('"text" must be a string.', 400);
        const result = await nap(text);
        const id = remember(result);
        return json(res, 200, { id, url: `${origin}/n/${id}`, ...result });
      }

      const shareMatch = url.pathname.match(/^\/n\/([A-Za-z0-9_-]{8})$/);
      if (req.method === 'GET' && shareMatch) {
        const r = store.get(shareMatch[1]);
        if (!r) return html(res, 404, '<p style="font-family:system-ui;padding:40px">That nap is gone. <a href="/">Take a new one.</a></p>');
        return html(res, 200, renderSharePage(shareMatch[1], r, origin));
      }

      const apiMatch = url.pathname.match(/^\/api\/nap\/([A-Za-z0-9_-]{8})$/);
      if (req.method === 'GET' && apiMatch) {
        const r = store.get(apiMatch[1]);
        if (!r) return json(res, 404, { error: 'not found' });
        return json(res, 200, { id: apiMatch[1], ...r });
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      if (err instanceof NapError) return json(res, err.status, { error: err.message });
      console.error(err);
      return json(res, 500, { error: 'nap fell out of bed. Try again.' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  createServer().listen(port, () => {
    console.log(`nap is dozing at http://localhost:${port}`);
  });
}
