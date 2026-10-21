import fs from 'fs';
import { napify, NapError, NapResult } from './nap';

function readInput(): Promise<string> {
  const arg = process.argv[2];
  if (arg && arg !== '-') {
    return Promise.resolve(fs.readFileSync(arg, 'utf8'));
  }
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

export function renderCard(r: NapResult): string {
  const lines = [
    '',
    `  ${r.napScore}% nappable`,
    `  "${r.verdict}"`,
    '',
    `  tl;dr   ${r.tldr}`,
  ];
  if (r.needToKnow.length) {
    lines.push('', '  need to know');
    for (const b of r.needToKnow) lines.push(`    • ${b}`);
  }
  lines.push('', `  do this  ${r.action}`);
  lines.push('', `  ${r.stats.words.toLocaleString()} words · ~${Math.round(r.stats.savedSeconds / 60)} min saved`, '');
  return lines.join('\n');
}

async function main() {
  const text = await readInput();
  if (process.stdin.isTTY && !process.argv[2]) {
    console.error('usage: npm run nap -- <file>   or   cat thing.txt | npm run nap');
    process.exit(2);
  }
  try {
    const result = await napify(text);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderCard(result));
    }
  } catch (err) {
    if (err instanceof NapError) {
      console.error(`nap: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

if (require.main === module) {
  main();
}
