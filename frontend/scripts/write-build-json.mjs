import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
fs.mkdirSync(publicDir, { recursive: true });

const commit =
  process.env.RENDER_GIT_COMMIT ||
  process.env.GIT_COMMIT ||
  process.env.COMMIT_SHA ||
  '';

const payload = {
  commit,
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(publicDir, 'build.json'), JSON.stringify(payload));
console.log(`[build] wrote public/build.json commit=${commit || '(local)'}`);
