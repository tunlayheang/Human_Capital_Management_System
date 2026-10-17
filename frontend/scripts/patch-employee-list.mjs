import fs from 'fs';

const p = 'src/pages/EmployeeList.tsx';
let s = fs.readFileSync(p, 'utf8');

const start = s.indexOf('      <motion.div className="grid grid-cols-1 md:grid-cols-4 gap-6">');
const start2 = s.indexOf('      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">');
const idx = start2 !== -1 ? start2 : start;
if (idx === -1) throw new Error('grid start not found');

const end = s.indexOf('      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6">', idx);
if (end === -1) throw new Error('filter card not found');

const rep = `      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Employees" value={totalCount} icon={UserPlus} variant="primary" />
        <StatCard label="Active Employees" value={pageStats.activeOnPage} hint="On this page" icon={UserPlus} variant="success" />
        <StatCard label="New Hires (30d)" value={pageStats.newHiresOnPage} hint="On this page" icon={UserPlus} variant="neutral" />
        <StatCard label="Pending Approval" value={pageStats.pendingOnPage} hint="On this page" icon={UserPlus} variant="warning" />
      </div>

      <motion.div className="surface-card p-6">`;

s = s.slice(0, idx) + rep + s.slice(end);

s = s.replace(
  '      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">',
  '      <motion.div className="surface-card overflow-hidden">'
);
s = s.replace(
  /<div className="p-12 flex flex-col items-center justify-center">\s*<div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" \/>\s*<p className="mt-3 text-slate-600 dark:text-slate-400">Loading employees\.\.\.<\/p>\s*<\/div>/,
  '<PageLoading label="Loading employees..." />'
);

const reps = [
  [/border-b-2 border-blue-600/g, 'border-b-2 border-primary-600'],
  [/text-blue-600 dark:text-blue-400/g, 'text-primary-600 dark:text-primary-400'],
  [/hover:text-blue-600 dark:hover:text-blue-400/g, 'hover:text-primary-600 dark:hover:text-primary-400'],
  [
    /bg-blue-50 dark:bg-blue-900\/30 border-blue-500 text-blue-700 dark:text-blue-300/g,
    'bg-primary-50 dark:bg-primary-900/30 border-primary-500 text-primary-700 dark:text-primary-300',
  ],
];
for (const [a, b] of reps) s = s.replace(a, b);

s = s.replace(/<\/?motion\.div/g, (m) => m.replace(/motion\./g, ''));

fs.writeFileSync(p, s);
console.log('patched EmployeeList');
