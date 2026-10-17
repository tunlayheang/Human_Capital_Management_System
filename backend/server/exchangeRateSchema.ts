import { sequelize } from './db.js';

export async function ensureExchangeRateSchema(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      rate_id VARCHAR(64) NOT NULL PRIMARY KEY,
      effective_date DATE NOT NULL,
      khr_per_usd INT NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_by VARCHAR(64) NULL,
      modified_by VARCHAR(64) NULL,
      modified_at DATETIME NULL,
      approved_by VARCHAR(64) NULL,
      approved_at DATETIME NULL,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_exchange_rates_effective_date (effective_date),
      KEY idx_exchange_rates_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
