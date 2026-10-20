import fs from 'fs';
import path from 'path';
import { renderIndex, publicUrlFromEnv } from '../src/page';

const out = path.join(__dirname, '..', 'public');
fs.mkdirSync(out, { recursive: true });
const publicUrl = publicUrlFromEnv();
fs.writeFileSync(path.join(out, 'index.html'), renderIndex(publicUrl));
console.log(`built public/index.html for ${publicUrl}`);
