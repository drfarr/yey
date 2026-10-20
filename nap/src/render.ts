import type { NapResult } from './nap';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function savedLabel(savedSeconds: number): string {
  return savedSeconds >= 60 ? `${Math.round(savedSeconds / 60)} min saved` : `${savedSeconds} sec saved`;
}

export function renderSharePage(id: string, r: NapResult, origin: string): string {
  const title = `${r.napScore}% nappable: ${r.verdict}`;
  const pageUrl = `${origin}/n/${id}`;
  const imageUrl = `${origin}/api/og?id=${id}`;
  const bullets = r.needToKnow.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · nap</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>😴</text></svg>">
<meta property="og:type" content="website">
<meta property="og:site_name" content="nap">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(r.tldr)}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta property="og:image" content="${escapeHtml(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(r.tldr)}">
<meta name="twitter:image" content="${escapeHtml(imageUrl)}">
<style>
:root{color-scheme:dark}body{margin:0;background:#0b0b10;color:#f2f1ec;font:17px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:620px;margin:0 auto;padding:48px 16px 80px}
.brand{font-weight:800;letter-spacing:-.04em;font-size:22px;opacity:.7;text-decoration:none;color:inherit}
.score{font-size:88px;font-weight:800;letter-spacing:-.04em;line-height:1;color:#ffd166;margin-top:28px}
.score small{font-size:22px;font-weight:600;color:rgba(242,241,236,.55);margin-left:6px;letter-spacing:0}
.verdict{font-size:26px;font-weight:700;margin:12px 0 28px}
h3{font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.5;margin:24px 0 6px}
ul{padding-left:20px;margin:0}li{margin:6px 0}
.pill{display:inline-block;background:#1b1b24;padding:6px 12px;border-radius:999px;font-size:14px;opacity:.85;margin-top:28px}
a.cta{display:block;margin-top:40px;padding:16px;border-radius:14px;background:#f2f1ec;color:#0b0b10;text-decoration:none;text-align:center;font-weight:700;font-size:18px}
</style></head><body><main>
<a class="brand" href="/">nap</a>
<div class="score">${r.napScore}%<small>nappable</small></div>
<div class="verdict">“${escapeHtml(r.verdict)}”</div>
<h3>tl;dr</h3><p>${escapeHtml(r.tldr)}</p>
${r.needToKnow.length ? `<h3>need to know</h3><ul>${bullets}</ul>` : ''}
<h3>do this</h3><p>${escapeHtml(r.action)}</p>
<span class="pill">${r.stats.words.toLocaleString()} words · ${savedLabel(r.stats.savedSeconds)}</span>
<a class="cta" href="/">nap through your own →</a>
</main></body></html>`;
}

export function renderNotFound(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>gone · nap</title></head>
<body style="font-family:system-ui;padding:40px;background:#0b0b10;color:#f2f1ec"><p>That nap is gone. <a style="color:#ffd166" href="/">Take a new one.</a></p></body></html>`;
}
