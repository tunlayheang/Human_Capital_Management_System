import { sequelize } from './db.js';

/** Tables removed from the app — employee IDs and onboarding drafts no longer use DB counters. */
const LEGACY_TABLES = ['employeeidsequences', 'employeeonboardingsessions'] as const;

export async function dropLegacyEmployeeTables(): Promise<void> {
  for (const table of LEGACY_TABLES) {
    try {
      const [rows] = await sequelize.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = :table`,
        { replacements: { table }, raw: true }
      );
      const exists = Number((rows as { c?: number | string }[])[0]?.c ?? 0) > 0;
      if (!exists) continue;

      await sequelize.query(`DROP TABLE \`${table}\``, { raw: true });
      console.log(`[db] Dropped legacy table \`${table}\`.`);
    } catch (e) {
      console.warn(
        `[db] Could not drop legacy table \`${table}\`:`,
        (e as Error)?.message || e
      );
    }
  }
}
