import type { VercelRequest, VercelResponse } from '@vercel/node';
import { HttpResult, ipFrom, originFrom } from './handlers';

export function send(res: VercelResponse, r: HttpResult): void {
  res.status(r.status);
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.send(r.body);
}

export function ipOf(req: VercelRequest): string {
  return ipFrom(req.headers['x-forwarded-for'], req.socket?.remoteAddress);
}

export function originOf(req: VercelRequest): string {
  return originFrom(req.headers.host, req.headers['x-forwarded-proto'] ?? 'https');
}

export function param(req: VercelRequest, name: string): string | undefined {
  const v = req.query[name];
  return Array.isArray(v) ? v[0] : v;
}
