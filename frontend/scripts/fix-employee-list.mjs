import fs from 'fs';

const path = 'src/pages/EmployeeList.tsx';
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

const flexLine = lines.findIndex((l) => l.includes('flex flex-col lg:flex-row gap-4'));
if (flexLine < 0) throw new Error('flex row not found');

// First surface-card after stat grid (around line 427)
const surfaceLine = lines.findIndex(
  (l, i) => i > 400 && i < flexLine && l.trim() === '<div className="surface-card p-6">'
);
if (surfaceLine < 0) throw new Error('surface-card block not found');

const before = lines.slice(0, surfaceLine);
const after = lines.slice(flexLine);
const merged = [
  ...before,
  '      <div className="surface-card p-6">',
  '        <motion.div className="flex flex-col lg:flex-row gap-4">'.replace('motion.', ''),
  ...after.slice(1),
];

let out = merged.join('\n');
out = out.replace(/<\/?motion\.div/g, (m) => m.replace('motion.', ''));

fs.writeFileSync(path, out);
console.log(`Removed duplicate lines ${surfaceLine + 1}-${flexLine}`);
