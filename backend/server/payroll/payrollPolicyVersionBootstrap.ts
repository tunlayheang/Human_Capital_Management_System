import { PayrollComplianceRule, TaxBracket } from '../db.js';
import { DEFAULT_PAYROLL_COMPLIANCE_RULES, rowToComplianceApi } from '../payrollComplianceRuleService.js';
import { taxBracketsToPayrollApi } from '../taxBracketService.js';
import { nssfBracketsToPayrollApi, DEFAULT_NSSF_ASSUMED_WAGE_BRACKETS } from '../nssfAssumedWageService.js';
import { createPolicyVersion, listPolicyVersions } from './payrollPolicyVersionService.js';
import { ensurePayrollPolicyVersionSchema } from './payrollPolicyVersionSchema.js';

const LEGACY_EFFECTIVE_FROM = '2020-01-01';

/** Snapshot current rule tables into versioned policies (once). */
export async function ensureInitialPayrollPolicyVersions(): Promise<void> {
  await ensurePayrollPolicyVersionSchema();

  try {
    const existingExchange = await listPolicyVersions({ policyType: 'exchange_rate' });
    if (existingExchange.length === 0) {
      const { getLegacyPayrollExchangeRateFromSetting } = await import(
        '../payrollExchangeRateService.js'
      );
      const rate = await getLegacyPayrollExchangeRateFromSetting();
      await createPolicyVersion({
        policyType: 'exchange_rate',
        effectiveFrom: LEGACY_EFFECTIVE_FROM,
        payload: { exchangeRateKhrPerUsd: rate },
        notes: 'Migrated from legacy exchange rate setting',
        createdBy: 'system-bootstrap',
      });
    }
  } catch (err) {
    console.warn(
      '[payroll-policy] Exchange rate bootstrap skipped:',
      (err as Error)?.message || err
    );
  }

  try {
    const existingTax = await listPolicyVersions({ policyType: 'tax_brackets' });
    if (existingTax.length === 0) {
      const dbRows = await TaxBracket.findAll({
        where: { isActive: true },
        order: [['minIncome', 'ASC']],
      });
      const brackets =
        dbRows.length > 0
          ? taxBracketsToPayrollApi(
              dbRows.map((r) => r.get({ plain: true }) as Record<string, unknown>)
            )
          : taxBracketsToPayrollApi(
              (await import('../taxBracketService.js')).DEFAULT_TAX_BRACKETS_USD.map((b) => ({
                minIncome: b.minIncome,
                maxIncome: b.maxIncome,
                rate: b.rate,
                baseTax: b.baseTax,
              }))
            );
      await createPolicyVersion({
        policyType: 'tax_brackets',
        effectiveFrom: LEGACY_EFFECTIVE_FROM,
        payload: { brackets },
        notes: 'Migrated from legacy taxbrackets table',
        createdBy: 'system-bootstrap',
      });
    }
  } catch (err) {
    console.warn('[payroll-policy] Tax brackets bootstrap skipped:', (err as Error)?.message || err);
  }

  try {
    const existingNssf = await listPolicyVersions({ policyType: 'nssf_wage_table' });
    if (existingNssf.length === 0) {
      const { NssfAssumedWageBracket } = await import('../db.js');
      const nssfRows = await NssfAssumedWageBracket.findAll({
        where: { isActive: true },
        order: [['sortOrder', 'ASC'], ['level', 'ASC']],
      });
      const nssfBrackets =
        nssfRows.length > 0
          ? nssfBracketsToPayrollApi(
              nssfRows.map((r) => {
                const row = r.get({ plain: true }) as Record<string, unknown>;
                return {
                  level: Number(row.level),
                  wageMinKhr: Number(row.wageMinKhr),
                  wageMaxKhr: row.wageMaxKhr == null ? null : Number(row.wageMaxKhr),
                  assumedWageKhr: Number(row.assumedWageKhr),
                };
              })
            )
          : nssfBracketsToPayrollApi(DEFAULT_NSSF_ASSUMED_WAGE_BRACKETS);
      await createPolicyVersion({
        policyType: 'nssf_wage_table',
        effectiveFrom: LEGACY_EFFECTIVE_FROM,
        payload: { brackets: nssfBrackets },
        notes: 'Migrated from legacy NSSF wage table',
        createdBy: 'system-bootstrap',
      });
    }
  } catch (err) {
    console.warn('[payroll-policy] NSSF wage table bootstrap skipped:', (err as Error)?.message || err);
  }

  try {
    const rows = await PayrollComplianceRule.findAll({ where: { isActive: true } });
    const seedRules =
      rows.length > 0
        ? rows.map((r) =>
            rowToComplianceApi(r.get({ plain: true }) as Parameters<typeof rowToComplianceApi>[0])
          )
        : DEFAULT_PAYROLL_COMPLIANCE_RULES.filter((r) => r.ruleKey !== 'nssf_health').map((r) =>
            rowToComplianceApi({ ...r, config: r.config })
          );

    for (const rule of seedRules) {
      if (rule.ruleKey === 'nssf_health') continue;
      const existing = await listPolicyVersions({
        policyType: 'compliance_rule',
        policyKey: rule.ruleKey,
      });
      if (existing.length > 0) continue;
      await createPolicyVersion({
        policyType: 'compliance_rule',
        policyKey: rule.ruleKey,
        effectiveFrom: LEGACY_EFFECTIVE_FROM,
        payload: {
          name: rule.name,
          legalRef: rule.legalRef,
          description: rule.description,
          config: rule.config,
        },
        notes: 'Migrated from legacy payrollcompliancerules',
        createdBy: 'system-bootstrap',
      });
    }
  } catch (err) {
    console.warn(
      '[payroll-policy] Compliance rules bootstrap skipped:',
      (err as Error)?.message || err
    );
  }
}
