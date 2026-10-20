import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHandlers, json } from '../src/handlers';
import { send, ipOf, originOf } from '../src/vercel';

const handlers = createHandlers();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return send(res, json(405, { error: 'POST {"text": "..."} to nap.' }));
  send(res, await handlers.createNap(req.body, ipOf(req), originOf(req)));
}
