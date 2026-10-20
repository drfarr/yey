import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHandlers } from '../../src/handlers';
import { send, param, originOf } from '../../src/vercel';

const handlers = createHandlers();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  send(res, await handlers.sharePage(param(req, 'id'), originOf(req)));
}
