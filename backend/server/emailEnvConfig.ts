import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envLocalPath = () => path.join(process.cwd(), '.env.local');

/** Reload secrets from backend/.env.local (gitignored). */
export const reloadEnvLocal = (): void => {
  const p = envLocalPath();
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: true });
  }
};

/** Upsert keys in backend/.env.local and apply to process.env. */
export const upsertEnvLocal = (entries: Record<string, string>): void => {
  const p = envLocalPath();
  let lines: string[] = [];
  if (fs.existsSync(p)) {
    lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  }

  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
  reloadEnvLocal();
};
