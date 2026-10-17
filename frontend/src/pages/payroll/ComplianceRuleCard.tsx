import React from 'react';
import { BookOpen } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import type { PayrollComplianceRule } from '../../types';
import { inputClass } from '../../constants/designSystem';
import {
  COMPLIANCE_RULE_FIELDS,
  complianceFieldLabel,
  formatComplianceDisplayValue,
} from './complianceRuleDisplay';
import { RulesConfigHelp } from '../../components/ui/RulesConfigHelp';
import { getPayrollComplianceHelpId } from '../../content/rulesConfigHelpContent';
import { PayrollPolicyVersionMetaLine } from '../../components/payroll/PayrollPolicyVersionMetaLine';
import { usePayrollRulesCurrency } from '../../context/PayrollRulesCurrencyContext';
import { CurrencyAmountField } from '../../components/ui/CurrencyAmountField';

const rowHeaderClass =
  'flex items-center justify-between gap-2 px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700';

type ViewProps = {
  rule: PayrollComplianceRule;
  headerActions?: React.ReactNode;
};

function ComplianceRuleHelp({ ruleKey }: { ruleKey: string }) {
  const helpId = getPayrollComplianceHelpId(ruleKey);
  if (!helpId) return null;
  return <RulesConfigHelp help={helpId} className="absolute top-3 right-3 z-20" />;
}

export const ComplianceRuleViewCard: React.FC<ViewProps> = ({ rule, headerActions }) => {
  const { currency, exchangeRateKhrPerUsd } = usePayrollRulesCurrency();
  return (
    <Card className="border-none shadow-sm overflow-hidden">
      <ComplianceRuleHelp ruleKey={rule.ruleKey} />
      <div className={`${rowHeaderClass} pr-12`}>
        <p className="font-semibold text-slate-900 dark:text-white text-sm min-w-0">{rule.name}</p>
        <div className="flex items-center gap-2 shrink-0">
          {headerActions}
          <Badge variant="info" className="text-sm font-bold px-3 py-1 max-w-[14rem] text-right truncate">
            {formatComplianceDisplayValue(rule, { currency, exchangeRateKhrPerUsd })}
          </Badge>
        </div>
      </div>
      <div className="px-5 py-4 space-y-2">
        <p className="text-xs text-primary-600 dark:text-primary-400 flex items-center gap-1">
          <BookOpen className="w-3.5 h-3.5 shrink-0" />
          {rule.legalRef}
        </p>
        <PayrollPolicyVersionMetaLine
          lastUpdatedAt={rule.lastUpdatedAt}
          effectiveFrom={rule.effectiveFrom}
          scheduledEffectiveFrom={rule.scheduledEffectiveFrom}
        />
      </div>
    </Card>
  );
};

type EditProps = {
  rule: PayrollComplianceRule;
  headerActions?: React.ReactNode;
  onMetaChange: (
    ruleKey: string,
    field: 'name' | 'legalRef' | 'description',
    value: string
  ) => void;
  onConfigChange: (
    ruleKey: string,
    field: string,
    raw: string,
    type?: 'number' | 'text'
  ) => void;
};

export const ComplianceRuleEditCard: React.FC<EditProps> = ({
  rule,
  headerActions,
  onMetaChange,
  onConfigChange,
}) => {
  const { currency, exchangeRateKhrPerUsd } = usePayrollRulesCurrency();

  return (
    <Card className="border-none shadow-sm overflow-hidden ring-2 ring-primary-500/20">
      <ComplianceRuleHelp ruleKey={rule.ruleKey} />
      <div className={`${rowHeaderClass} pr-12`}>
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-0">{rule.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          {headerActions}
          <Badge variant="info" className="text-sm font-bold px-3 py-1 max-w-[14rem] text-right truncate">
            {formatComplianceDisplayValue(rule, { currency, exchangeRateKhrPerUsd })}
          </Badge>
        </div>
      </div>
      <div className="p-5 space-y-3">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase text-slate-500">Rule name</span>
          <input
            type="text"
            readOnly
            value={rule.name}
            className={`${inputClass} mt-1 bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 cursor-default`}
            aria-readonly
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase text-slate-500 flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5" />
            Legal reference
          </span>
          <input
            type="text"
            value={rule.legalRef}
            onChange={(e) => onMetaChange(rule.ruleKey, 'legalRef', e.target.value)}
            className={`${inputClass} mt-1`}
            placeholder="e.g. Sub-Decree No. 28"
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
          {(COMPLIANCE_RULE_FIELDS[rule.ruleKey] ?? []).map((field) => (
            <label key={field.key} className="block">
              <span className="text-[10px] font-semibold uppercase text-slate-500">
                {complianceFieldLabel(field, currency)}
              </span>
              {field.money === 'khr' || field.money === 'usd' ? (
                <CurrencyAmountField
                  storage={field.money}
                  className={`${inputClass} mt-1`}
                  value={Number(rule.config[field.key] ?? 0)}
                  currency={currency}
                  exchangeRateKhrPerUsd={exchangeRateKhrPerUsd}
                  onValueChange={(next) =>
                    onConfigChange(rule.ruleKey, field.key, String(next), field.type ?? 'number')
                  }
                />
              ) : (
                <input
                  type={field.type === 'text' ? 'text' : 'number'}
                  step={field.step}
                  value={String(rule.config[field.key] ?? '')}
                  onChange={(e) =>
                    onConfigChange(
                      rule.ruleKey,
                      field.key,
                      e.target.value,
                      field.type ?? 'number'
                    )
                  }
                  className={`${inputClass} mt-1`}
                />
              )}
            </label>
          ))}
        </div>
      </div>
    </Card>
  );
};
