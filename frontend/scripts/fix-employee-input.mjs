import fs from 'fs';

const path = 'src/pages/EmployeeInput.tsx';
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

const start = lines.findIndex((l) => l.includes('min-h-screen bg-slate-50'));
if (start < 0) throw new Error('return block start not found');

const end = lines.findIndex((l, i) => i > start && l.trim() === ');' && lines[i + 1]?.trim() === '};');
if (end < 0) throw new Error('return block end not found');

const replacement = `  return (
    <div className="space-y-6">
      <motion.div className="surface-card p-4 sm:p-5">
        <motion.div className="flex flex-wrap items-center justify-between gap-4">
          <motion.div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/employees')}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors shrink-0"
              aria-label="Back to employee list"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <motion.div className="min-w-0">
              <motion.div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                  {id ? t('onboarding.editTitle') : t('onboarding.title')}
                </h2>
                {id ? (
                  <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase rounded-full">
                    {t('common.active')}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold uppercase rounded-full">
                    Draft
                  </span>
                )}
              </motion.div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {id ? \`\${t('onboarding.editSubtitle')} \${watchAll.firstName}\` : t('onboarding.subtitle')}
              </p>
            </motion.div>
          </motion.div>

          <motion.div className="flex items-center gap-3 shrink-0">
            {lastSaved && (
              <span className="hidden sm:flex text-[10px] uppercase font-bold tracking-wider text-slate-400 items-center">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" />
                {t('onboarding.messages.saved')}{' '}
                {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {id ? (
              <Button variant="outline" size="sm" onClick={() => void handleSaveChanges()} className="hidden md:inline-flex">
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleSaveDraft} className="hidden md:inline-flex">
                <Save className="w-4 h-4 mr-2" /> {t('onboarding.buttons.saveDraft')}
              </Button>
            )}
          </motion.div>
        </motion.div>
      </motion.div>

      <motion.div className="surface-card overflow-hidden px-2 sm:px-4 py-3">
        <EmployeeWizardStepper steps={WIZARD_STEPS} currentStep={currentStep} onStepChange={jumpToStep} />
      </motion.div>

      <motion.div className="surface-card p-6 md:p-8">
        {isLoadingData ? (
          <FormSkeleton />
        ) : (
          <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
            {Object.keys(errors).length > 0 && (
              <motion.div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <motion.div>
                  <h4 className="text-sm font-bold text-red-800 dark:text-red-300">{t('onboarding.messages.attention')}</h4>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">{t('onboarding.messages.fixErrors')}</p>
                </motion.div>
              </motion.div>
            )}
            {renderStepContent()}
          </form>
        )}
      </motion.div>

      <motion.div className="surface-card p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
        <motion.div>
          {currentStep > 0 ? (
            <Button variant="ghost" onClick={handlePrev} className="text-slate-600 dark:text-slate-300">
              <ChevronLeft className="w-4 h-4 mr-2" /> {t('onboarding.buttons.back')}
            </Button>
          ) : (
            !id && (
              <button
                type="button"
                className="inline-flex items-center text-xs font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors px-3 py-2 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20"
              >
                <Download className="w-3.5 h-3.5 mr-2" /> {t('onboarding.buttons.importCsv')}
              </button>
            )
          )}
        </motion.div>
        <motion.div className="flex gap-3 justify-end">
          {currentStep < WIZARD_STEPS.length - 1 ? (
            <Button onClick={handleNext} className="shadow-lg shadow-primary-500/20 px-6">
              {t('onboarding.buttons.next')} <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit(onSubmit)}
              isLoading={isSubmitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/30 px-8"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {id ? t('onboarding.buttons.saveProfile') : t('onboarding.buttons.finish')}
            </Button>
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );`;

const clean = replacement.replace(/<\/?motion\.div/g, (m) => m.replace('motion.', ''));

const out = [...lines.slice(0, start), ...clean.split('\n'), ...lines.slice(end + 1)];
fs.writeFileSync(path, out.join('\n'));
console.log('EmployeeInput layout updated');
