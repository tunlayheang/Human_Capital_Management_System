import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCreateTableSqlValid,
  assertInsertColumnValueAlignment,
  escapeMysqlInsertValue,
  hasAnsiQuotedCreateTable,
  normalizeAnsiQuotedIdentifiers,
  normalizeJsonColumnLiterals,
  parseInsertStatement,
  repairExpandedJsonInserts,
  rewriteInsertTimestampNulls,
  sanitizeCreateTableSql,
  sanitizeDumpSql,
  splitSqlValues,
} from '../scripts/sqlSanitize.js';

describe('normalizeAnsiQuotedIdentifiers', () => {
  it('converts ANSI-quoted CREATE TABLE identifiers to backticks', () => {
    const input =
      'CREATE TABLE "departments" ( "id" varchar(255) NOT NULL, "name" varchar(255) );';
    const out = normalizeAnsiQuotedIdentifiers(input);
    assert.match(out, /CREATE TABLE `departments`/);
    assert.match(out, /`id` varchar/);
    assert.match(out, /`name` varchar/);
    assert.doesNotMatch(out, /"/);
    assert.equal(hasAnsiQuotedCreateTable(out), false);
  });

  it('converts CREATE TABLE IF NOT EXISTS with ANSI quotes', () => {
    const input =
      'CREATE TABLE IF NOT EXISTS "departments" ( "id" varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL );';
    const out = normalizeAnsiQuotedIdentifiers(input);
    assert.match(out, /CREATE TABLE IF NOT EXISTS `departments`/);
    assert.equal(hasAnsiQuotedCreateTable(out), false);
    assert.equal(hasAnsiQuotedCreateTable(input), true);
  });

  it('converts curly/smart double quotes to backticks', () => {
    const input = 'CREATE TABLE \u201Cdepartments\u201D ( \u201Cid\u201D varchar(255) );';
    const out = normalizeAnsiQuotedIdentifiers(input);
    assert.match(out, /CREATE TABLE `departments`/);
    assert.match(out, /`id` varchar/);
  });

  it('leaves single-quoted string literals unchanged', () => {
    const input = `INSERT INTO "users" ("id", "name") VALUES ('u-1', 'O''Brien');`;
    const out = normalizeAnsiQuotedIdentifiers(input);
    assert.equal(out, "INSERT INTO `users` (`id`, `name`) VALUES ('u-1', 'O''Brien');");
  });

  it('leaves existing backtick identifiers alone', () => {
    const input = 'CREATE TABLE `employees` ( `id` varchar(255) );';
    assert.equal(normalizeAnsiQuotedIdentifiers(input), input);
  });
});

describe('escapeMysqlInsertValue', () => {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    // Simulate mysql2.escape(array) expansion — must never be reached for objects/arrays.
    if (Array.isArray(v)) return v.map((x) => escape(x)).join(', ');
    return `'${String(v)}'`;
  };

  it('stringifies JSON arrays as a single value (does not expand)', () => {
    const items = [
      { id: 'ati-1', amount: 50 },
      { id: 'ati-2', amount: 30 },
    ];
    const out = escapeMysqlInsertValue(escape, items);
    assert.equal(out, `'${JSON.stringify(items).replace(/'/g, "''")}'`);
    assert.equal(splitSqlValues(out).length, 1);
  });

  it('stringifies plain objects as a single value', () => {
    const out = escapeMysqlInsertValue(escape, { days: [0, 6] });
    assert.equal(out, `'${JSON.stringify({ days: [0, 6] })}'`);
  });

  it('passes through null and primitives', () => {
    assert.equal(escapeMysqlInsertValue(escape, null), 'NULL');
    assert.equal(escapeMysqlInsertValue(escape, 'hi'), "'hi'");
    assert.equal(escapeMysqlInsertValue(escape, 7), '7');
  });
});

describe('INSERT column/value alignment', () => {
  const allowanceCreate = `CREATE TABLE \`allowance_templates\` (
  \`id\` varchar(255) NOT NULL,
  \`template_name\` varchar(160) NOT NULL,
  \`department_id\` varchar(255) DEFAULT NULL,
  \`role_id\` varchar(255) DEFAULT NULL,
  \`active\` tinyint(1) DEFAULT 1,
  \`items_json\` longtext,
  \`created_at\` datetime NOT NULL,
  \`updated_at\` datetime NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

  it('parses JSON items_json with nested braces as one value', () => {
    const stmt =
      "INSERT INTO `allowance_templates` (`id`, `template_name`, `department_id`, `role_id`, `active`, `items_json`, `created_at`, `updated_at`) VALUES ('atpl-manager', 'Manager package', NULL, 'MANAGER', 1, '[{\"id\":\"ati-mgr-meal\",\"amount\":50},{\"id\":\"ati-mgr-position\",\"amount\":100}]', '2026-05-24 16:43:59.000', '2026-05-24 16:43:59.000');";
    const parsed = parseInsertStatement(stmt);
    assert.ok(parsed);
    assert.equal(parsed!.cols.length, 8);
    assert.equal(parsed!.vals.length, 8);
  });

  it('rejects dumps where JSON array was expanded into multiple VALUES', () => {
    // Broken shape from mysql2.escape(array): 8 cols, 10 values
    const broken = `${allowanceCreate}
INSERT INTO \`allowance_templates\` (\`id\`, \`template_name\`, \`department_id\`, \`role_id\`, \`active\`, \`items_json\`, \`created_at\`, \`updated_at\`) VALUES ('atpl-manager', 'Manager package', NULL, 'MANAGER', 1, '{\\"id\\":\\"a\\"}', '{\\"id\\":\\"b\\"}', '{\\"id\\":\\"c\\"}', '2026-05-24 16:43:59.000', '2026-05-24 16:43:59.000');
`;
    assert.throws(() => assertInsertColumnValueAlignment(broken), /not restore-safe|column\(s\) but/);
  });

  it('accepts a well-formed allowance_templates dump', () => {
    const good = `${allowanceCreate}
INSERT INTO \`allowance_templates\` (\`id\`, \`template_name\`, \`department_id\`, \`role_id\`, \`active\`, \`items_json\`, \`created_at\`, \`updated_at\`) VALUES ('atpl-manager', 'Manager package', NULL, 'MANAGER', 1, '[{\\"id\\":\\"ati-mgr-meal\\",\\"amount\\":50}]', '2026-05-24 16:43:59.000', '2026-05-24 16:43:59.000');
`;
    assert.doesNotThrow(() => assertInsertColumnValueAlignment(good));
  });

  it('rewrites NULL createdAt without truncating JSON VALUES', () => {
    const input =
      "INSERT INTO `allowance_templates` (`id`, `items_json`, `createdAt`, `created_at`) VALUES ('atpl-1', '[{\"a\":1}]', NULL, '2026-01-01 00:00:00');";
    const out = rewriteInsertTimestampNulls(input);
    const parsed = parseInsertStatement(out);
    assert.ok(parsed);
    assert.equal(parsed!.vals.length, 4);
    assert.equal(parsed!.vals[2], "'2026-01-01 00:00:00'");
  });

  it('does not truncate INSERT at semicolon inside a string literal', () => {
    const withCreate = `CREATE TABLE \`payrollcompliancerules\` (
  \`id\` varchar(255) NOT NULL,
  \`ruleKey\` varchar(255) NOT NULL,
  \`name\` varchar(255) NOT NULL,
  \`legalRef\` varchar(255) DEFAULT NULL,
  \`description\` text,
  \`config\` json,
  \`sortOrder\` int,
  \`isActive\` tinyint(1),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO \`payrollcompliancerules\` (\`id\`, \`ruleKey\`, \`name\`, \`legalRef\`, \`description\`, \`config\`, \`sortOrder\`, \`isActive\`) VALUES ('pcr-nssf_healthcare', 'nssf_healthcare', 'NSSF Health Care', 'NSSF / MLVT', 'Employer pays 100%; no employee deduction.', '{"employeePct":0}', 3, 1);
`;
    assert.doesNotThrow(() => assertInsertColumnValueAlignment(withCreate));
    const parsed = parseInsertStatement(
      "INSERT INTO `payrollcompliancerules` (`id`, `ruleKey`, `name`, `legalRef`, `description`, `config`, `sortOrder`, `isActive`) VALUES ('pcr-nssf_healthcare', 'nssf_healthcare', 'NSSF Health Care', 'NSSF / MLVT', 'Employer pays 100%; no employee deduction.', '{\"employeePct\":0}', 3, 1);"
    );
    assert.equal(parsed?.cols.length, 8);
    assert.equal(parsed?.vals.length, 8);
  });

  it('splits values with MySQL doubled quotes', () => {
    const vals = splitSqlValues("'O''Brien', 'ok'");
    assert.deepEqual(vals, ["'O''Brien'", "'ok'"]);
  });
});

describe('repairExpandedJsonInserts', () => {
  it('collapses expanded permissions string arrays', () => {
    const sql = `CREATE TABLE \`permissiontemplates\` (
  \`id\` varchar(255) NOT NULL,
  \`name\` varchar(255) NOT NULL,
  \`permissions\` json DEFAULT NULL,
  \`createdAt\` datetime NOT NULL,
  PRIMARY KEY (\`id\`)
);
INSERT INTO \`permissiontemplates\` (\`id\`, \`name\`, \`permissions\`, \`createdAt\`) VALUES ('role-menu-employee', 'Sidebar', '/dashboard', '/profile', '/chat', '2026-08-06 18:21:19.000');
`;
    const { repairedCount, sql: out, unresolved } = repairExpandedJsonInserts(sql);
    assert.equal(repairedCount, 1);
    assert.equal(unresolved.length, 0);
    assert.match(out, /"\/dashboard","\/profile","\/chat"/);
    assert.doesNotThrow(() => assertInsertColumnValueAlignment(out));
  });

  it('restores allowance items_json from seed when dump has [object Object]', () => {
    const sql = `CREATE TABLE \`allowance_templates\` (
  \`id\` varchar(255) NOT NULL,
  \`template_name\` varchar(160) NOT NULL,
  \`items_json\` json DEFAULT NULL,
  \`created_at\` datetime NOT NULL,
  PRIMARY KEY (\`id\`)
);
INSERT INTO \`allowance_templates\` (\`id\`, \`template_name\`, \`items_json\`, \`created_at\`) VALUES ('atpl-manager', 'Manager package', '[object Object]', '[object Object]', '[object Object]', '2026-08-06 18:20:22.000');
`;
    // Note: placeholders are unquoted incorrectly in real dumps they're quoted
    const sql2 = sql.replace(
      "'[object Object]', '[object Object]', '[object Object]'",
      "'[object Object]', '[object Object]', '[object Object]'"
    );
    const { repairedCount, sql: out, notes } = repairExpandedJsonInserts(sql2);
    assert.equal(repairedCount, 1);
    assert.ok(notes.some((n) => /seed/i.test(n)));
    assert.match(out, /ati-mgr-meal/);
  });
});

describe('CREATE TABLE trailing comma sanitize', () => {
  it('removes trailing comma before ) when ENGINE is omitted', () => {
    const input = `CREATE TABLE \`allowance_types\` (
  \`id\` varchar(255) NOT NULL,
  \`code\` varchar(64) NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`code\` (\`code\`),
);`;
    const out = sanitizeDumpSql(input);
    assert.match(out, /UNIQUE KEY `code` \(`code`\)\s*\)\s*ENGINE=/i);
    assert.doesNotMatch(out, /,\s*\)/);
    assert.doesNotThrow(() => assertCreateTableSqlValid(out));
  });

  it('sanitizeCreateTableSql strips trailing comma before ENGINE', () => {
    const input = `CREATE TABLE \`t\` (
  \`id\` varchar(255) NOT NULL,
  PRIMARY KEY (\`id\`),
) ENGINE=InnoDB;`;
    const out = sanitizeCreateTableSql(input);
    assert.doesNotMatch(out, /,\s*\)/);
    assert.match(out, /PRIMARY KEY \(`id`\)\s*\)\s*ENGINE=/i);
  });
});

describe('normalizeJsonColumnLiterals', () => {
  it('wraps bare numbers and plain strings for JSON columns', () => {
    const sql = `CREATE TABLE \`systemsettings\` (
  \`id\` varchar(255) NOT NULL,
  \`key\` varchar(255) NOT NULL,
  \`value\` json DEFAULT NULL,
  PRIMARY KEY (\`id\`)
);
INSERT INTO \`systemsettings\` (\`id\`, \`key\`, \`value\`) VALUES ('ss-10', 'attendance.latePenalty', 50);
INSERT INTO \`systemsettings\` (\`id\`, \`key\`, \`value\`) VALUES ('ss-13', 'payroll.cycle', 'monthly');
INSERT INTO \`systemsettings\` (\`id\`, \`key\`, \`value\`) VALUES ('ss-8', 'workingHours.workingDays', '[1,2,3,4,5]');
`;
    const { sql: out, fixedCount } = normalizeJsonColumnLiterals(sql);
    assert.ok(fixedCount >= 2);
    assert.match(out, /latePenalty',\s*'50'\)/);
    assert.match(out, /payroll\.cycle',\s*'"monthly"'\)/);
    assert.match(out, /workingDays',\s*'\[1,2,3,4,5\]'\)/);
  });
});
