import {
  LEAVE_CATEGORY_LABELS,
  LEAVE_CATEGORY_RULES,
  type LeaveCategoryRuleCard,
} from '../utils/leaveTypeCategory';

export type RulesConfigHelpField = {
  name: string;
  effect: string;
};

export type RulesConfigHelpCategoryBlock = {
  name: string;
  summary: string;
  items: Array<{ label: string; value: string }>;
  doesNot?: string[];
  example?: string;
};

export type RulesConfigHelpContent = {
  title: string;
  summary: string;
  fields?: RulesConfigHelpField[];
  /** Rich blocks (e.g. leave category renewal rules). */
  categories?: RulesConfigHelpCategoryBlock[];
  notes?: string[];
};

function leaveCategoryToHelpBlock(rule: LeaveCategoryRuleCard): RulesConfigHelpCategoryBlock {
  return {
    name: LEAVE_CATEGORY_LABELS[rule.category],
    summary: rule.summary,
    items: [
      { label: 'Balance', value: rule.balance },
      { label: 'Renewal', value: rule.renewal },
      { label: 'Accrual', value: rule.accrual },
      { label: 'Carry forward', value: rule.carryForward },
      { label: 'Usage', value: rule.deduction },
    ],
    doesNot: rule.doesNot.length > 0 ? rule.doesNot : undefined,
    example: rule.example,
  };
}

export function getLeaveTypesConfigHelp(): RulesConfigHelpContent {
  return {
    title: 'Leave type configuration',
    summary:
      'Defines what employees can request. Renewal, accrual, and balance behavior are driven only by category — not by leave type name. New custom types follow the same rules when you pick a category.',
    fields: [
      {
        name: 'Leave type name',
        effect: 'Label on request forms, balances, and calendars.',
      },
      {
        name: 'Category',
        effect:
          'Chooses which renewal/accrual rules apply (see category rules below). Changing category changes system behavior; renaming the type does not.',
      },
      {
        name: 'Default days/year',
        effect: 'Starting or annual entitlement for allocation/accrual categories only.',
      },
      {
        name: 'Carry forward',
        effect: 'Whether unused days roll to the next year (with optional max).',
      },
      {
        name: 'Paid / Unpaid',
        effect: 'Whether approved leave consumes paid entitlement and affects payroll.',
      },
      {
        name: 'Requires approval / document',
        effect: 'Workflow and attachment requirements before leave is active.',
      },
    ],
    categories: LEAVE_CATEGORY_RULES.map(leaveCategoryToHelpBlock),
    notes: [
      'Monthly accrual job runs for accrual-based types; year-end renewal for accrual-based and fixed allocation.',
      'Event-based and approval-based types are excluded from those automated jobs.',
      'Join-date accrual: join month accrues 1.5 / 1 / 0.5 by join day (1–9 / 10–19 / 20–end); later months use the monthly rate. Requests use yearly entitlement, not the monthly accrual cap.',
      'Standard monthly accrual: days earned each month; requests limited to accrued-to-date balance.',
    ],
  };
}

export const RULES_CONFIG_HELP = {
  'attendance.leaderboard': {
    title: 'Leaderboard (Top Early Birds)',
    summary: 'Ranks employees by punctuality points over the selected period.',
    notes: [
      '+10 on time · −5 late · leave/off/absent not scored',
      'Click an employee for day-by-day points and rank explanation.',
    ],
  },
  'attendance.adminList': {
    title: 'Administrative view',
    summary:
      'Review team attendance and check-in locations. Status and hours use Cambodia office time (ICT).',
    notes: [
      'Live database — Rows with check-in/out times are stored in attendancerecords.',
      'Last 7 days lists every active employee for each ICT day through today (all statuses).',
      'All records lists every eligible employee for each ICT day in the last 90 days (from join date), including days without clock-in yet.',
      'Today includes roster preview for staff not yet clocked in.',
    ],
  },
  'attendance.clockRules': {
    title: 'Clock-in / clock-out rules',
    summary:
      'Company-wide defaults for mobile and web attendance. GPS and zone toggles apply at the moment an employee taps clock-in or clock-out. Lateness uses a hybrid rule: each employee’s work schedule (time_in and optional grace_period_minutes on their HR record) takes priority; when those are missing, the values on this card are used. Saved to system settings (attendance.clock_rules) and take effect immediately after you click Save attendance settings.',
    fields: [
      {
        name: 'Location & GPS enforcement',
        effect:
          'Editable company defaults for whether clock-in/out require GPS and whether the employee must be inside an office geofence. Click Edit, change the toggles, then Save attendance settings.',
      },
      {
        name: 'Lateness policy',
        effect:
          'Late starts after office time-in plus the grace period below. Employee schedules still override when set on the HR record.',
      },
      {
        name: 'Require GPS to clock in',
        effect:
          'The app must receive coordinates before clock-in succeeds. If off, employees can clock in without location (useful for desk-only sites). When on, failed or denied GPS shows an error and no attendance row is created.',
      },
      {
        name: 'Must be inside zone to clock in',
        effect:
          'After GPS is read, the server checks distance to every active office geofence below. If the employee is farther than the zone radius from all offices, clock-in is rejected with a distance message. Requires at least one office location configured.',
      },
      {
        name: 'Require GPS to clock out',
        effect:
          'Same as clock-in GPS, but for clock-out. Location is stored as location-out on the attendance record for audit and reports.',
      },
      {
        name: 'Must be inside zone to clock out',
        effect:
          'Rarely enabled. When on, employees cannot clock out unless still inside a zone—often blocks people who already left the building. Leave off unless policy requires end-of-day check-out on site.',
      },
      {
        name: 'Late after — hour / minute',
        effect:
          'Fallback start-of-day for lateness only when the employee has no valid time_in. Example: 09:00 + 15 min grace → first minute counted LATE is 09:16. Does not override an employee scheduled for 08:00.',
      },
      {
        name: 'Grace period (minutes)',
        effect:
          'Company default buffer after start time before status becomes LATE. Example: start 08:00, grace 15 → on-time through 08:15, LATE from 08:16. If the employee record has grace_period_minutes set, that number wins over this global value.',
      },
    ],
    notes: [
      'Formula: LATE when clock-in time > start minutes + grace minutes (time-of-day comparison).',
      'PRESENT vs LATE is set at clock-in and recalculated when HR corrects clock times.',
      'ABSENT / ON_LEAVE / DAY_OFF come from leave and roster logic, not from this card.',
    ],
  },
  'attendance.officeGeofence': {
    title: 'Office geofence',
    summary:
      'One physical site in your multi-office list. The center point and radius define a circle on the map; at clock-in the system measures straight-line distance (meters) from the employee GPS to this center. Department-level required worksites can further restrict specific teams, but these offices are the global list used when “inside zone” rules are enabled.',
    fields: [
      {
        name: 'Office name',
        effect:
          'Displayed in settings, zone lists, and error messages (“You are 120m from Office 1…”). Use clear names (branch, building, or campus).',
      },
      {
        name: 'Address',
        effect:
          'Optional label for admins only; not used in distance calculation. Helpful for documentation and onboarding.',
      },
      {
        name: 'Latitude / Longitude',
        effect:
          'Center of the geofence circle (WGS84). Must be accurate—small errors shift the whole zone. Set via map click, drag, or “Use my GPS” while standing at the entrance.',
      },
      {
        name: 'Zone radius (meters)',
        effect:
          'Employees inside this distance from the center count as “in zone.” Typical values: 50–150 m for a single building, larger for campuses. Too small causes false rejections; too large allows clock-in from far away.',
      },
      {
        name: 'Use my GPS for office point',
        effect:
          'Sets lat/lng to your current device position. Best used on-site when configuring; saves manual coordinate entry.',
      },
    ],
    notes: [
      'With multiple offices, clock-in is allowed inside any one active zone (OR logic).',
      'Removing an office here does not delete past attendance; it only affects future zone checks.',
    ],
  },
  'attendance.zonePreview': {
    title: 'Zone preview',
    summary:
      'Live map to verify pin placement and radius before saving. The blue circle shows the same radius used at clock-in. Changes here update the selected office’s coordinates in memory until you save attendance settings.',
    fields: [
      {
        name: 'Click map / drag pin',
        effect: 'Updates latitude and longitude for the office selected in the left list.',
      },
      {
        name: 'Radius slider (on geofence card)',
        effect: 'Resizes the circle on this map in real time so you can see coverage at building entrances and parking areas.',
      },
    ],
    notes: [
      'Always save after editing offices or rules—unsaved changes are lost on refresh.',
    ],
  },
  'attendance.officeLocations': {
    title: 'Office locations',
    summary:
      'Manage all company geofences in one place. Add branches, factories, or co-working sites. Zone enforcement compares the employee GPS against every office in this list.',
    fields: [
      {
        name: 'Add location',
        effect:
          'Creates a new office row with default coordinates; configure name, radius, and map pin before saving.',
      },
    ],
  },
  'overtime.monthlyCap': {
    title: 'Company monthly overtime cap',
    summary:
      'Hard limit on total approved overtime hours per employee per calendar month (all OT types combined). Stored in system settings (overtime.globalMaxHoursPerMonth). Request validation runs before approval; payroll may also reference totals. Raising the cap allows more OT; lowering it can block pending requests that would exceed the new limit.',
    fields: [
      {
        name: 'Hours per employee / month',
        effect:
          'Example: cap 80 → once an employee has 80 approved OT hours in March, additional March requests are rejected until next month or HR adjusts records. Click Save monthly cap to persist; the OT request form uses the saved value immediately.',
      },
    ],
    notes: [
      'Per-type daily limits (max hours/day) are separate and configured on each overtime type.',
      'Inactive employees or rejected requests do not count toward the cap—only approved hours in the month.',
    ],
  },
  'overtime.types': {
    title: 'Overtime types',
    summary:
      'Catalog of overtime categories (weekday OT, rest day, holiday, etc.). Employees choose a type when submitting OT. Each type has its own validation rules and pay rate tier; payroll applies the matching multiplier from Payroll Rules when OT is paid.',
    fields: [
      {
        name: 'OT type name / Description',
        effect:
          'Name appears in dropdowns and approvals. Description helps employees pick the correct type and helps HR audit misclassified OT.',
      },
      {
        name: 'Pay rate (rate tier)',
        effect:
          'Links to Cambodian-style tiers (e.g. 150% daytime, 200% premium). Payroll engine uses compliance overtime multipliers together with this tier when computing OT pay lines.',
      },
      {
        name: 'Min hours',
        effect:
          'Smallest request size—e.g. 0.25 prevents one-minute OT submissions; 2 requires at least two hours per request.',
      },
      {
        name: 'Max per day',
        effect:
          'Caps hours for this type on a single calendar day regardless of monthly cap—stops duplicate or excessive same-day OT.',
      },
      {
        name: 'Advance notice (days)',
        effect:
          '0 = same-day allowed; 3 = request must be submitted at least three days before the OT work date. Enforced when the employee submits.',
      },
      {
        name: 'Start and end time',
        effect:
          'Forces planned from/to times on the request. Useful for night shifts or union rules requiring scheduled OT windows.',
      },
      {
        name: 'Clock-in and clock-out',
        effect:
          'Requires actual clock times on the request for verification against attendance records or manual proof.',
      },
      {
        name: 'Status (Active / Inactive)',
        effect:
          'Inactive types disappear from new requests but remain on historical OT and reports. Reactivate anytime without losing configuration.',
      },
    ],
    notes: [
      'Deleting a type does not remove past approved OT; it only prevents new use of that type.',
    ],
  },
  'payroll.exchangeRate': {
    title: 'Payroll exchange rate (KHR / USD)',
    summary:
      'Used across the payroll engine. Converts USD salary to KHR for net pay display, NSSF wage calculations, and GDT dependent relief (150,000 KHR per dependent per month). Tax bracket amounts on the ToS card are edited separately; this rate affects dependent deductions and KHR totals.',
    fields: [
      {
        name: 'Exchange rate (KHR per 1 USD)',
        effect:
          'Example: 4,100 means $100 gross displays as 410,000 KHR where needed. Should match your official payroll month rate (NBC or internal policy). Admin-only edit on this screen.',
      },
    ],
    notes: [
      'Allowed range when editing: 1,000 – 20,000 KHR per USD.',
      'After saving, re-run or preview payroll for open periods to see updated KHR figures.',
      'Locked/finalized payslips keep the rate from when they were finalized.',
      'Only Admin users can change this rate; HR and other roles can view it for payroll transparency.',
    ],
  },
  'payroll.taxBrackets': {
    title: 'Tax on Salary (ToS)',
    summary:
      'Cambodia GDT monthly ToS applied in payroll. Formula: Tax = (taxable base × rate%) − deduction. Edit brackets in KHR (payroll storage). USD values are calculated automatically from the exchange rate and cannot be edited.',
    fields: [
      {
        name: 'From / To (KHR)',
        effect:
          'Defines the income band stored for payroll. Top bracket often uses a very high max (open-ended). Keep brackets continuous with no gaps.',
      },
      {
        name: 'Rate (%)',
        effect:
          'Marginal percentage for income in this band. Combined with deduction below to match GDT formula on payslip.',
      },
      {
        name: 'Deduction (KHR)',
        effect:
          'Fixed subtraction in the bracket formula (GDT style). Incorrect deduction causes systematic over- or under-withholding across all employees in that band.',
      },
    ],
    notes: [
      'Dependent relief: 150,000 KHR per dependent (reduces taxable base before ToS).',
      'Ensure brackets are continuous. Use a very large “To” value for the final open-ended bracket.',
      'USD mirrors are display-only at the current KHR/USD rate.',
      'Chart preview shows bracket structure; verify after legal updates to ToS.',
    ],
  },
  'payroll.nssfWageTable': {
    title: 'NSSF assumed wage table',
    summary:
      'Ministry contributory wage levels — edit in KHR (stored for payroll). USD values are calculated from the exchange rate and cannot be edited. Leave max wage empty on the top level for “and above”.',
    fields: [
      {
        name: 'Level',
        effect: 'Sequential band number; used for ordering and display. Keep levels contiguous for easier maintenance.',
      },
      {
        name: 'Wage min / max (KHR)',
        effect:
          'Monthly wage range in KHR that selects this row. Leave max empty on the top row for “and above” open-ended bands.',
      },
      {
        name: 'Assumed wage (KHR)',
        effect:
          'Base multiplied by pension % from NSSF pension rule. Example: gross 2,829,000 KHR maps to level 22 → assumed 1,200,000 KHR → pension calculated on 1.2M, not on full gross.',
      },
    ],
    notes: [
      'Update when NSSF publishes new contributory wage tables.',
      'Works together with pension % and employee max deduction on the NSSF pension compliance card.',
    ],
  },
  'payroll.minimum_wage': {
    title: 'Minimum wage',
    summary:
      'Legal minimum gross pay floor used by the payroll engine. If calculated salary for a period is below this amount, the system can adjust or flag per compliance settings—protecting against underpayment in payroll runs and reports.',
    fields: [
      {
        name: 'Amount (USD)',
        effect:
          'Minimum gross for the chosen period (e.g. monthly $200). Applies when running payroll for eligible employees.',
      },
      {
        name: 'Period',
        effect:
          'Usually “month”—defines whether the amount is per month or another pay period. Must align with how you run payroll (monthly vs semi-monthly).',
      },
    ],
    notes: [
      'Align with current Cambodian minimum wage regulations and your company pay cycle.',
    ],
  },
  'payroll.nssf_occupational_risk': {
    title: 'NSSF occupational risk',
    summary:
      'Occupational risk insurance contribution rates for payroll. Split between employee deduction (if any) and employer cost. Applied as percentages of the relevant wage base during each payroll calculation and shown on payslip/statutory reports.',
    fields: [
      {
        name: 'Employee %',
        effect:
          'Portion deducted from employee pay. Set to 0 if employer-only for this component.',
      },
      {
        name: 'Employer %',
        effect:
          'Employer contribution—cost to company, not deducted from employee net pay. Appears in employer cost reports.',
      },
    ],
    notes: [
      'Total % is employee + employer; verify against latest NSSF circulars.',
    ],
  },
  'payroll.nssf_healthcare': {
    title: 'NSSF healthcare',
    summary:
      'Health insurance contribution rates. Same pattern as other NSSF lines: employee share may reduce net pay; employer share is company cost. Calculated during payroll run from configured percentages.',
    fields: [
      {
        name: 'Employee %',
        effect: 'Deducted from employee according to payroll engine rules for the period.',
      },
      {
        name: 'Employer %',
        effect: 'Employer-side statutory cost for reporting and total cost of employment.',
      },
    ],
  },
  'payroll.nssf_pension': {
    title: 'NSSF pension',
    summary:
      'Pension scheme settings: employee and employer percentages, monthly cap on employee deduction, and assumed wage ceiling before table lookup. Pension amount uses assumed wage from the NSSF wage table when salary falls in a band.',
    fields: [
      {
        name: 'Employee %',
        effect:
          'Percentage of assumed wage taken from employee pay, capped by employee max deduction (KHR/month).',
      },
      {
        name: 'Employer %',
        effect: 'Employer pension contribution on the same assumed wage base.',
      },
      {
        name: 'Employee max deduction (KHR/month)',
        effect:
          'Ceiling on employee pension per month—e.g. 24,000 KHR max even if % × wage would be higher.',
      },
      {
        name: 'Assumed wage cap (KHR)',
        effect:
          'Upper limit on wage used before band table; wages above cap use cap for lookup purposes.',
      },
    ],
    notes: [
      'Example flow: gross → KHR monthly wage → wage table row → assumed wage → apply % and cap.',
    ],
  },
  'payroll.seniority_indemnity': {
    title: 'Seniority indemnity policies',
    summary:
      'Semi-annual indemnity per Art. 89 (New) — paid in June and December for UDC employees. Each semester is evaluated independently (7.5 days when eligible). FDC contracts use a separate 5% severance rule, not indemnity. Only active policies are applied to payroll.',
    fields: [
      {
        name: 'Days per year',
        effect: 'Total indemnity days accrued per calendar year of eligible service.',
      },
      {
        name: 'June / December payout (days)',
        effect:
          'Days paid in each payout month. Must sum to at most days per year for full-year employees.',
      },
      {
        name: 'Daily rate method',
        effect: 'Divisor for converting salary basis into a daily rate (26 scheduled days or actual working days).',
      },
      {
        name: 'Active policy',
        effect: 'Only checked/active policies are included in payroll. Inactive templates never pay.',
      },
    ],
    notes: [
      'When you save, confirm the effective date in the dialog — the payroll engine uses the version effective for each payroll month.',
      'With no active policy, payroll Indemnity column stays $0 until you activate one here.',
    ],
  },
  'payroll.overtime_multipliers': {
    title: 'Overtime multipliers',
    summary:
      'Default multipliers for OT pay calculation on payroll (e.g. 1.5× normal, 2× premium). Work with Overtime types’ rate tiers and approved OT hours. Changing multipliers affects future payroll runs, not locked payslips.',
    fields: [
      {
        name: 'Normal OT multiplier',
        effect: 'Applied to standard overtime hours (often 1.5).',
      },
      {
        name: 'Premium OT multiplier',
        effect: 'Applied to premium tiers—night, Sunday, or holiday OT (often 2.0).',
      },
    ],
    notes: [
      'Must stay consistent with labor law and your OT type configuration.',
    ],
  },
  'payroll.seniorityRules': {
    title: 'Seniority policies',
    summary:
      'Optional monthly service seniority (tenure bonus on every payroll). Only active policies are included—inactive templates are never applied. Amounts are prorated when an employee works part of the month. For semi-annual indemnity (June / December), use the indemnity card on this tab.',
    fields: [
      { name: 'Accrual', effect: 'How much is earned per month before proration.' },
      { name: 'Eligibility', effect: 'Active status, contract type, probation, minimum working days.' },
      { name: 'Proration', effect: '(Eligible days ÷ scheduled days) × monthly accrual for mid-month join/exit.' },
      { name: 'Ledger', effect: 'Accrual, payment, and adjustment entries with running balance.' },
      { name: 'Final settlement', effect: 'Outstanding ledger balance paid on offboarding when configured.' },
    ],
    notes: [
      'Extra monthly pay based on years of service — separate from base salary and allowances.',
      'When you save, confirm the effective date in the dialog — the payroll engine uses the version effective for each payroll month.',
      'Service tiers: example 0–2 years → set monthly amount; use 99 in “To” for an open-ended top tier.',
      'Policies apply automatically by priority and eligibility — no per-employee assignment.',
      'Keep one active “all employees” policy unless you use department/role filters.',
      'seniorityIndemnity on payslip remains the legal semi-annual indemnity (compliance rules).',
      'With no active policy, payroll Seniority column stays $0 until you activate one here.',
      'Multiple active “all employees” policies: payroll picks one per person (lowest priority, then newest effective date). Deactivate duplicates you do not need.',
    ],
  },
  'payroll.seniorityExamplePreview': {
    title: 'Example calculation (monthly seniority)',
    summary:
      'Runs a sample employee through the active policy engine. Uses $500 base salary, join date 2020-01-15, and 22 present days out of 26 eligible payroll days for the current month.',
    fields: [
      {
        name: 'This month (prorated)',
        effect: 'Accrual after proration for partial attendance or mid-month join/exit.',
      },
      {
        name: 'Paid on payslip',
        effect: 'Amount that would appear on the monthly payslip for this sample (respects payment frequency).',
      },
      {
        name: 'If full year',
        effect: 'Projected annual accrual if the employee worked every eligible day all year.',
      },
    ],
    notes: [
      'Click Example calculation to refresh. “None” means no active policy matched the sample month.',
      'Common block reasons: no_rule (no policy), probation, min_working_days, employment_type.',
    ],
  },
  'payroll.seniorityIndemnityExamplePreview': {
    title: 'Example calculation (indemnity)',
    summary:
      'Sample June indemnity for a UDC employee ($940 base, joined 2020-01-15, 26 scheduled days). Only active indemnity policies apply.',
    fields: [
      { name: 'Payout days', effect: 'Indemnity days due this semester (e.g. 7.5 in June or December).' },
      { name: 'Amount', effect: 'Payout in payroll currency after daily rate × days.' },
      { name: 'Daily rate', effect: 'Salary basis ÷ working-days divisor from the policy.' },
    ],
    notes: [
      'Indemnity pays in June and December payroll only. FDC contracts use severance, not indemnity.',
      'Formula line shows how daily rate and days combine when eligible.',
    ],
  },
  'payroll.unifiedRules': {
    title: 'Work days & leave payroll',
    summary:
      'Work day method sets the salary basis divisor (employee vs company). Paid vs unpaid leave types drive payable-day calculations. Mark leave types as Paid or Unpaid in Leaves — that is the only leave configuration needed. Present, Late, Absent, and Paid/Unpaid leave statuses in Attendance are automatic.',
    notes: [
      'Company or employee basis days apply to daily/hourly rates for all staff under that policy.',
      'Only two payroll leave categories: paid (payable) and unpaid (deductible).',
      'Re-run payroll after changing a leave type’s Paid flag; finalized payslips keep snapshots.',
      'Allowances and seniority use their own tabs under Payroll → Rules.',
    ],
  },
  'payroll.allowanceRules': {
    title: 'Allowance rules configuration',
    summary:
      'Flexible allowance engine for Cambodian payroll: define allowance types, build conditional rules (department, position, attendance, salary band, etc.), and assign templates. Enabled rules add allowance lines on the next payroll run. Approved/finalized payslips snapshot values at finalize time.',
    fields: [
      {
        name: 'Allowance types',
        effect:
          'Master list (transport, meal, housing, etc.). Each rule references a type; types control GL coding and payslip labels.',
      },
      {
        name: 'Rule builder',
        effect:
          'Create IF conditions (e.g. department = Sales AND grade ≥ 5) THEN fixed amount or formula. Toggle On/Off without deleting. Disabled rules are skipped on the next run.',
      },
      {
        name: 'Templates',
        effect:
          'Bundle rules for groups—assign template to new hires or departments to apply the same allowance package quickly. Each allowance type may appear only once per template (one rule per type).',
      },
    ],
    notes: [
      'Requires payroll rules edit permission to change; others can view configuration.',
      'In one template, do not add two rows with the same allowance type—pick one rule for that type.',
      'Monthly service seniority is configured on the Seniority tab, not as an allowance type.',
    ],
  },
  'payroll.allowanceRuleFixed': {
    title: 'Fixed monthly amount',
    summary:
      'Pays the same Fixed amount each month when the rule is assigned (via package/template) and conditions pass. Percentage rate is not used for this rule type.',
    fields: [
      {
        name: 'Fixed amount',
        effect: 'The USD amount paid when the rule applies. This is the primary pay value.',
      },
      {
        name: 'Requires base salary',
        effect:
          'When enabled in conditions, employees with no base salary are skipped. When disabled, the fixed amount can still pay.',
      },
    ],
    notes: [
      'Assign the rule through an allowance package/template so payroll includes it.',
      'Toggle the rule Off to skip it on the next run without deleting it.',
    ],
  },
  'payroll.allowanceRuleAttendance': {
    title: 'Attendance-based allowance',
    summary:
      'Pays up to a full amount based on present/late days and absences in the payroll month. Percentage rate on the rule is not used — reduction percents live in the conditions section.',
    fields: [
      {
        name: 'Full allowance amount',
        effect:
          'Maximum pay when attendance criteria are met. Falls back to Fixed amount if not set in conditions.',
      },
      {
        name: 'Minimum present/late days',
        effect: 'Below this count, the rule pays $0 for the month.',
      },
      {
        name: 'Max late days / absence %',
        effect:
          'Too many late days uses the “1 absence” percent. 1 absence and 2+ absences each have their own % of the full amount.',
      },
      {
        name: 'Fixed amount',
        effect: 'Fallback only when Full allowance amount is empty in conditions.',
      },
    ],
    notes: [
      'Uses attendance for the salary month (present, late, absent).',
      'A $0 result can still be recorded for attendance rules so the line shows as evaluated.',
    ],
  },
  'payroll.allowanceRulePosition': {
    title: 'Job title allowance',
    summary:
      'Pays a fixed amount when assigned via an allowance package, or auto-applies when the employee’s job title matches optional filters. Portal role never blocks payment.',
    fields: [
      {
        name: 'Amount (conditions) / Fixed amount',
        effect:
          'Pay value. Condition amount is preferred; Fixed amount is the fallback when amount is empty.',
      },
      {
        name: 'Job title filters',
        effect:
          'Optional. When set, auto-apply without a package only if the position title contains one of the listed phrases. Empty filters → assign via package only.',
      },
    ],
    notes: [
      'Packages always pay the configured amount when this rule is on the package row.',
      'Portal login role is never used as a payment gate for this rule type.',
    ],
  },
  'payroll.allowanceRuleConditional': {
    title: 'Department or custom',
    summary:
      'Pays a fixed amount when department and/or position filters match. Portal role is never a payment gate. Percentage rate is not used.',
    fields: [
      {
        name: 'Department / position filters',
        effect:
          'If lists are set, the employee must match; empty lists mean no filter on that dimension.',
      },
      {
        name: 'Amount (conditions) / Fixed amount',
        effect:
          'Pay value. Condition amount is preferred; Fixed amount is used when amount is empty.',
      },
    ],
    notes: [
      'Use this for department- or job-id–scoped allowances that are not attendance/OT/commission.',
      'Assign via package/template so the type is included in the payroll run.',
    ],
  },
  'payroll.allowanceCommission': {
    title: 'Sales / commission pay',
    summary:
      'When Sales Target meets the minimum, commission is % of sales. When Sales Target is below the minimum, the Fixed amount is paid instead (if set). Fixed and % are never added together.',
    fields: [
      {
        name: 'Minimum sales',
        effect:
          'Gate for percentage pay. Sales at or above this use Percentage rate × Sales Target. Below this, Fixed amount is used as fallback (or $0 if Fixed is empty).',
      },
      {
        name: 'Percentage rate',
        effect:
          'Percent of actual monthly sales when the minimum is met. Example: min $5,000, rate 3%, sales $10,000 → commission = $300 (3% of $10,000), not 3% of $5,000.',
      },
      {
        name: 'Fixed amount',
        effect:
          'Fallback when Sales Target is below Minimum sales (e.g. sales $300, min $5,000, fixed $60 → pay $60). Also used if the gate is met but % × sales is still $0. Not stacked on top of the percentage.',
      },
    ],
    notes: [
      'Enter each employee’s monthly sales on Payroll → Overview → Sales Target for that salary month.',
      'Example: min $5,000, rate 3%, fixed $60 — sales $7,000 → $210; sales $300 → $60; sales blank and fixed $0 → $0.',
      'If you also set Commission rate (%) in the conditions section, that value overrides Percentage rate.',
    ],
  },
  'leaves.leaveTypes': getLeaveTypesConfigHelp(),
  'settings.securitySession': {
    title: 'Session policy',
    summary:
      'Organization-wide idle logout and password lockout. Saved to security settings and enforced on every authenticated request and password login.',
    fields: [
      {
        name: 'Session timeout (minutes)',
        effect:
          'Idle time since last activity before the session is revoked. Short values (15–30) improve security; longer values (120+) reduce friction for office workers.',
      },
      {
        name: 'Max login attempts',
        effect:
          'Failed password tries before lockout—e.g. 5 attempts stops brute force. Successful login or OTP sign-in resets the counter.',
      },
      {
        name: 'Locked period (minutes)',
        effect:
          'Account cannot sign in with a password during lockout. After this period, the user can try again.',
      },
    ],
    notes: [
      'Works with password policy on the same Security tab.',
      'Users see a clear message when locked or when the session expires from inactivity.',
    ],
  },
  'settings.securityPassword': {
    title: 'Password policy',
    summary:
      'Minimum standards for new passwords and password changes. Enforced when users set password, reset password, or admin creates accounts. Does not retroactively expire existing passwords unless you run a separate reset campaign.',
    fields: [
      {
        name: 'Minimum password length',
        effect:
          'Shorter passwords rejected at validation. 12+ recommended for sensitive HR data.',
      },
      {
        name: 'Password complexity',
        effect:
          'Each selected class must appear at least once (e.g. uppercase + number + special). More classes = stronger passwords but harder for users to remember.',
      },
      {
        name: 'Default password',
        effect:
          'Optional. When enabled, a temporary password is assigned to new portal accounts when no custom password is provided. When disabled, admins must set a password for each new account. New staff must change their password on first sign-in either way. Changing this setting does not reset existing accounts.',
      },
    ],
  },
  'settings.securityAuthentication': {
    title: 'Authentication',
    summary:
      'Additional sign-in protection for the whole tenant. When MFA is required, users must complete a second factor after password on supported flows.',
    fields: [
      {
        name: 'MFA required',
        effect:
          'When enabled, sign-in flow demands multi-factor authentication per your MFA setup. When disabled, password-only login is allowed (subject to session and lockout rules).',
      },
    ],
    notes: [
      'Plan rollout: enable MFA after users enroll devices to avoid lockouts.',
    ],
  },
  'overtime.approval': {
    title: 'OT Approval',
    summary: 'Review, approve, or reject team overtime requests.',
    notes: [
      'Only approved overtime is paid.',
      'HR defines overtime types and rules under Configuration; employees submit using the Core and Time form.',
    ],
  },
  'payroll.attendanceFinalize': {
    title: 'Attendance finalization',
    summary: 'Lock attendance for payroll review through the cutoff date.',
    notes: [
      'After freeze, HR edits to existing attendance through the cutoff date are view-only for payroll review. New records for missing days can still be added. Employee clock-in and clock-out always continue to work. Reopen attendance to correct frozen rows before running payroll.',
      'Cutoff date is set on the payroll calendar. The salary month runs from the day after the previous cutoff through this month’s cutoff (for example June 26 → July 25 for a July payroll with cutoffs on the 25th). Days after cutoff belong to the next salary month.',
      'Attendance freeze (manual and automatic) becomes available at 12:00 midnight ICT (00:00) on the cutoff date. Live clock-in/out is never blocked by freeze.',
    ],
  },
  'payroll.preRunPreview': {
    title: 'Pre-Run Payroll Detail Preview',
    summary: '',
    notes: [],
  },
  'payroll.policyEffectiveDate': {
    title: 'Policy effective date',
    summary:
      'Policy changes are scheduled — they do not apply instantly. When you click Save, confirm the effective date in the dialog. The payroll engine uses the version effective for each payroll month.',
    fields: [
      {
        name: 'Effective from',
        effect:
          'Required in the Save confirmation dialog. New versions apply from this date forward for matching payroll months. Past months keep their prior policy snapshot.',
      },
    ],
    notes: [
      'Saved effective from shows the date currently stored on the active version.',
      'Scheduled shows a future effective date waiting to become active.',
    ],
  },
  'payroll.workDayMethod': {
    title: 'Payroll work day method',
    summary:
      'Controls the salary daily-rate divisor. Attendance metrics come from attendance records only — not roster planning.',
    fields: [
      {
        name: 'Fixed Employee Basis',
        effect:
          'Each employee’s payroll basis days (22, 24, or 26) determine the daily salary rate.',
      },
      {
        name: 'Fixed Company Basis',
        effect:
          'One company-wide payroll basis applies to all employees. Set the company basis days when this method is selected.',
      },
    ],
    notes: [
      'When you save, confirm the effective date in the dialog on Payroll Rules.',
      'Daily rate = monthly salary ÷ basis days for unpaid leave and mid-month adjustments.',
    ],
  },
  'payroll.createRun': {
    title: 'Create payroll run',
    summary:
      'Computes salaries for all active employees using Cambodia Labor Law rules (NSSF, ToS, OT, Seniority).',
    notes: [
      'Finalize attendance for the month before calculating when the workflow requires it.',
      'Approved and locked payslips are not overwritten by a new run for the same period.',
    ],
  },
  'payroll.payment': {
    title: 'Payroll payment',
    summary:
      'Release salary payslips to employees after payroll is approved. Mark Paid to publish the payslip in My Pay, or Holding to notify the employee that payment is paused.',
    notes: [
      'Only approved runs appear in the payment queue.',
      'Payment status (Paid / Holding / Pending) can be changed for 1 month after approval, then becomes permanently read-only.',
      'Bank export uses the payment method and account details on each payslip row.',
    ],
  },
  'settings.companyStructureLevels': {
    title: 'Position levels',
    summary:
      'Define the job levels used when creating positions in departments. Use the arrows to set order — tier numbers (1, 2, 3…) update automatically and control ranking on the org structure. Org chart grouping uses the org chart tier column.',
    fields: [
      {
        name: 'Label / code',
        effect: 'Shown on position forms and org charts. Codes should stay unique.',
      },
      {
        name: 'Org chart tier',
        effect: 'Groups roles as Management, Officer, or Staff on the org chart.',
      },
    ],
  },
  'settings.companyProfile': {
    title: 'Company profile',
    summary:
      'Organization identity used across letters, reports, payslips, login branding, and compliance exports.',
    fields: [
      {
        name: 'General',
        effect: 'Legal name, industry, website, and organization contact details.',
      },
      { name: 'Portal appearance', effect: 'Portal logo shown on the login page and inside the app.' },
      { name: 'Structure', effect: 'Job levels used when defining positions.' },
    ],
    notes: ['Changes affect all users and departments once saved.'],
  },
  'kpi.gradeScale': {
    title: 'KPI grade scale',
    summary:
      'Customize letter grades, chart values, and pay raise rates used in reviews and salary follow-up.',
    fields: [
      { name: 'Grade / label', effect: 'Letter code and display name on appraisal results.' },
      { name: 'Min score %', effect: 'Lowest overall score that maps to this grade.' },
      { name: 'Chart value', effect: 'Numeric value used in charts and averages.' },
      {
        name: 'Pay raise rate %',
        effect:
          'Suggested salary increase when this grade triggers a pay change or promotion follow-up.',
      },
    ],
  },
  'kpi.appraisalPeriods': {
    title: 'Appraisal periods',
    summary:
      'Set the review window for KPI appraisals. Alert date is optional — on that date, HR, managers, and admins receive an inbox reminder to start or continue reviews.',
    fields: [
      { name: 'Period name / type', effect: 'Label and cadence (e.g. H1, annual) for the review cycle.' },
      { name: 'Start / end', effect: 'Inclusive review window for appraisals in this period.' },
      {
        name: 'Alert date',
        effect: 'Optional reminder date; must be on or after the period start date.',
      },
    ],
  },
  'kpi.scoringRules': {
    title: 'Scoring rules',
    summary:
      'Manual comment threshold, attendance deductions, and grade recommendations for KPI appraisals.',
    fields: [
      {
        name: 'Comment threshold',
        effect: 'Managers must add a comment when a manual score is below this percentage.',
      },
      {
        name: 'Attendance deductions',
        effect:
          'Perfect attendance starts at 100. Use PER_OCCURRENCE for per-event deductions (late, absent, etc.).',
      },
    ],
  },
  'probation.reviewWorkflow': {
    title: 'Probation review workflow',
    summary:
      'Route reviews to managers, collect evaluations, then run the manager → employee → HR → approval workflow. Pick an employee below to start or continue a review.',
    fields: [
      {
        name: 'Overview',
        effect:
          'Counts people on probation, reviews due this month, and lifetime passed / extended / failed outcomes.',
      },
      {
        name: '1. Evaluator chain',
        effect:
          'HR (or Admin) selects one or more management evaluators in order and routes the review to them.',
      },
      {
        name: '2. Management evaluation',
        effect:
          'Each assigned manager rates performance criteria and adds notes. Multiple evaluators submit in sequence.',
      },
      {
        name: '3. Self evaluation',
        effect:
          'The employee completes their own ratings and comments before HR can finalize.',
      },
      {
        name: '4. Final evaluation',
        effect:
          'HR reviews combined scores, chooses Pass / Extend / Fail, optionally records movement details, and assigns approvers.',
      },
      {
        name: '5. Approval & complete',
        effect:
          'Assigned approvers sign off in order. On Pass, the employee is confirmed off probation; Extend sets a next review date; Fail records the outcome.',
      },
    ],
    notes: [
      'Use All / Active / Completed filters to focus the queue.',
      'Active status on periods and people still in scope drives who appears in the list.',
      'Approvers see pending items in their inbox until the chain is complete.',
    ],
  },
  'kpi.appraisalWorkflow': {
    title: 'KPI appraisal workflow',
    summary:
      'Generate appraisals for the selected period, then run manager → employee → HR → approval. Pick someone below to start or continue.',
    fields: [
      {
        name: 'Period',
        effect:
          'Choose an active appraisal period. Refresh generates missing appraisals for eligible employees in that window.',
      },
      {
        name: 'Queue cards',
        effect:
          'Filter the list by Total, In review, Awaiting movement, or Complete. Counts update from the current period.',
      },
      {
        name: '1. Evaluator chain',
        effect:
          'Assign managers who score the employee’s KPI components for this period.',
      },
      {
        name: '2. Management evaluation',
        effect:
          'Managers score automatic and manual KPIs. Automatic metrics (e.g. attendance) are calculated by the system.',
      },
      {
        name: '3. Self evaluation',
        effect:
          'The employee submits their self-assessment before HR finalizes the appraisal.',
      },
      {
        name: '4. Final evaluation',
        effect:
          'HR reviews combined scores and grade, then submits for approval or records the outcome.',
      },
      {
        name: '5. Approval & movement',
        effect:
          'Approvers complete the chain. High grades may open a salary / position movement follow-up after the appraisal is locked.',
      },
    ],
    notes: [
      'Weights on active KPI components must total 100% in Configuration.',
      'Locked or finalized appraisals keep their scores until HR reopens them.',
      'Only enabled appraisal periods appear in the period picker.',
    ],
  },
  'attendance.qr': {
    title: 'Attendance QR',
    summary:
      'Generate a live QR code for employees to scan at the office entrance. The code rotates on a short TTL for security.',
    notes: [
      'Use Refresh to issue a new code immediately.',
      'Print or download the poster for a fixed display at the door.',
    ],
  },
  'wizard.salary.taxOnSalary': {
    title: 'Tax on salary (ToS)',
    summary:
      'Tax = (taxable base × marginal %) – bracket deduction. Rates follow Cambodia GDT ToS tables in Payroll Rules.',
  },
  'wizard.salary.serviceSeniority': {
    title: 'Service seniority',
    summary:
      'Service seniority follows active policies on Payroll → Rules → Seniority. Jun/Dec indemnity follows Labor Law Art. 89 compliance settings (UDC, prorated for mid-year joiners) — paid in June and December payroll only.',
  },
  'wizard.salary.allowancePackage': {
    title: 'Allowance package',
    summary:
      'Packages from Payroll → Rules → Templates. Salary Overview uses the selected package and active rules.',
  },
} as const satisfies Record<string, RulesConfigHelpContent>;

export type RulesConfigHelpId = keyof typeof RULES_CONFIG_HELP;

export function getRulesConfigHelp(id: RulesConfigHelpId): RulesConfigHelpContent {
  return RULES_CONFIG_HELP[id];
}

/** Payroll compliance cards use ruleKey; maps to help id or generic fallback. */
export function getPayrollComplianceHelpId(ruleKey: string): RulesConfigHelpId | null {
  const id = `payroll.${ruleKey}` as RulesConfigHelpId;
  return id in RULES_CONFIG_HELP ? id : null;
}
