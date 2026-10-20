import http from 'http';
import { ImageResponse } from '@vercel/og';
import { createHandlers, HandlerDeps, HttpResult, html, json, ipFrom, originFrom } from './handlers';
import { renderIndex } from './page';
import { getStore } from './store';
import { isValidId } from './ids';
import { ogElement } from './og';
import { NapError, MAX_CHARS } from './nap';

export interface ServerOptions extends HandlerDeps {
  og?: boolean;
}

function write(res: http.ServerResponse, r: HttpResult) {
  res.writeHead(r.status, r.headers);
  res.end(r.body);
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

/** Local dev server. On Vercel the files under api/ serve these routes instead. */
export function createServer(opts: ServerOptions = {}): http.Server {
  const store = opts.store ?? getStore();
  const handlers = createHandlers({ ...opts, store });
  const renderOg = opts.og ?? true;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ip = ipFrom(req.headers['x-forwarded-for'], req.socket.remoteAddress);
    const origin = originFrom(req.headers.host, req.headers['x-forwarded-proto']);

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return write(res, html(200, renderIndex(origin)));
      }
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return write(res, json(200, { ok: true, zzz: true }));
      }
      if (req.method === 'POST' && url.pathname === '/api/nap') {
        const raw = await readBody(req, MAX_CHARS * 4 + 1024);
        return write(res, await handlers.createNap(raw, ip, origin));
      }
      const share = url.pathname.match(/^\/n\/([^/]+)$/);
      if (req.method === 'GET' && share) {
        return write(res, await handlers.sharePage(share[1], origin));
      }
      const byId = url.pathname.match(/^\/api\/nap\/([^/]+)$/);
      if (req.method === 'GET' && byId) {
        return write(res, await handlers.getNap(byId[1]));
      }
      if (req.method === 'GET' && url.pathname === '/api/og' && renderOg) {
        const id = url.searchParams.get('id');
        const result = isValidId(id) ? await store.get(id) : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const img = new ImageResponse(ogElement(result, url.host || req.headers.host || 'nap') as any, { width: 1200, height: 630 });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(Buffer.from(await img.arrayBuffer()));
        return;
      }
      return write(res, json(404, { error: 'not found' }));
    } catch (err) {
      if (err instanceof NapError) return write(res, json(err.status, { error: err.message }));
      console.error(err);
      return write(res, json(500, { error: 'nap fell out of bed. Try again.' }));
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  createServer().listen(port, () => {
    console.log(`nap is dozing at http://localhost:${port}`);
  });
}
