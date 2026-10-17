import fs from 'fs';

const p = 'src/pages/Leaves.tsx';
let s = fs.readFileSync(p, 'utf8');

const start = s.indexOf('  return (\n    <motion.div className="space-y-6 pb-10">');
const start2 = s.indexOf('  return (\n    <div className="space-y-6 pb-10">');
const idx = start2 !== -1 ? start2 : start;
if (idx === -1) throw new Error('start not found');

const endMarker = '      ) : (\n        <>';
const end = s.indexOf(endMarker, idx);
if (end === -1) throw new Error('end not found');

const replacement = `  return (
    <PageShell>
      <PageHeader
        title={t('leaves.title')}
        subtitle="Request leave, approve requests, and plan team coverage."
        icon={<CalendarIcon className="w-6 h-6" />}
        actions={
          canSubmitLeave ? (
            <Button onClick={() => setIsModalOpen(true)} className="shadow-lg shadow-primary-500/20">
              <Plus className="w-4 h-4 mr-2" />
              {t('leaves.requestLeave')}
            </Button>
          ) : undefined
        }
      />

      <SegmentTabs tabs={leaveTabs} activeId={activeTab} onChange={(id) => setActiveTab(id as TabId)} />

      {loading ? (
        <PageLoading />
      ) : (
        <>`;

let out = s.slice(0, idx) + replacement + s.slice(end + endMarker.length);

// Remove old tab bar block if still present (between PageHeader replacement failure paths)
out = out.replace(
  /\n      <div className="inline-flex flex-wrap gap-1[\s\S]*?<\/motion.div>\n\n      \{loading \? \([\s\S]*?<PageLoading \/>/,
  '\n\n      {loading ? (\n        <PageLoading />'
);

if (!out.includes('<PageShell>')) {
  // strip duplicate header block manually
  const dupStart = out.indexOf('      <motion.div className="flex flex-col');
  const dupStart2 = out.indexOf('      <motion.div className="flex flex-col');
  const ds = out.indexOf('      <motion.div className="flex flex-col sm:flex-row');
  const ds2 = out.indexOf('      <motion.div className="flex flex-col sm:flex-row');
  const d = out.indexOf('      <motion.div className="flex flex-col sm:flex-row');
  const d2 = out.indexOf('      <div className="flex flex-col sm:flex-row');
  const dIdx = d2 !== -1 ? d2 : out.indexOf('      <motion.div className="flex flex-col sm:flex-row');
  if (dIdx !== -1 && out.indexOf('<PageShell>') === -1) {
    const tabEnd = out.indexOf('      {loading ?', dIdx);
    if (tabEnd !== -1) out = out.slice(0, dIdx) + out.slice(tabEnd);
  }
}

out = out.replace(/\n    <\/div>\n  \);\n\};\s*$/, '\n    </PageShell>\n  );\n};\n');

fs.writeFileSync(p, out);
console.log('done', out.includes('PageShell'), out.includes('tabClass'));
