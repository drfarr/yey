import fs from 'fs';
import path from 'path';

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

/** The landing page with absolute URLs for its social cards. */
export function renderIndex(publicUrl: string): string {
  return TEMPLATE.replace(/__PUBLIC_URL__/g, publicUrl.replace(/\/$/, ''));
}

export function publicUrlFromEnv(): string {
  if (process.env.NAP_PUBLIC_URL) return process.env.NAP_PUBLIC_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
