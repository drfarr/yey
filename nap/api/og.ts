import { ImageResponse } from '@vercel/og';
import { getStore } from '../src/store';
import { isValidId } from '../src/ids';
import { ogElement } from '../src/og';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const result = isValidId(id) ? await getStore().get(id) : null;
  const site = url.host;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ImageResponse(ogElement(result, site) as any, {
    width: 1200,
    height: 630,
    headers: {
      'cache-control': result ? 'public, max-age=0, s-maxage=86400, immutable' : 'public, max-age=0, s-maxage=3600',
    },
  });
}
