import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const i18nDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n');

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') keys.push(...flattenKeys(v, p));
    else keys.push(p);
  }
  return keys;
}

function getAtPath(obj, pathStr) {
  let cur = obj;
  for (const k of pathStr.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function setAtPath(obj, pathStr, value) {
  const parts = pathStr.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function parseExport(filePath, exportName) {
  const text = fs.readFileSync(filePath, 'utf8');
  const body = text.replace(new RegExp(`^[\\s\\S]*?export const ${exportName}[^=]*=\\s*`), '').replace(/;\s*$/, '');
  return eval(`(${body})`);
}

function stringifyTranslations(obj, depth = 0) {
  const indent = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);
  const lines = Object.entries(obj).map(([k, v]) => {
    if (v && typeof v === 'object') {
      return `${indent}${k}: ${stringifyTranslations(v, depth + 1)}`;
    }
    return `${indent}${k}: ${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(',\n')}\n${close}}`;
}

const enPath = path.join(i18nDir, 'en.ts');
const kmPath = path.join(i18nDir, 'km.ts');
const enObj = parseExport(enPath, 'en');
let kmObj = parseExport(kmPath, 'km');

const kmKeys = new Set(flattenKeys(kmObj));
let added = 0;
for (const key of flattenKeys(enObj)) {
  if (!kmKeys.has(key)) {
    const val = getAtPath(enObj, key);
    if (typeof val === 'string') {
      setAtPath(kmObj, key, val);
      added++;
    }
  }
}

fs.writeFileSync(
  kmPath,
  `import type { Translations } from './types';\n\nexport const km: Translations = ${stringifyTranslations(kmObj)};\n`
);

console.log(`Synced ${added} missing key(s) from en → km.`);
