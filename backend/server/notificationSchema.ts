import { DataTypes, QueryTypes } from 'sequelize';
import { sequelize } from './db.js';

let ready: Promise<void> | null = null;

/**
 * Upgrade legacy notification tables without requiring sync({ alter: true }).
 * Safe to call repeatedly and from production startup.
 */
export function ensureNotificationSchema(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const qi = sequelize.getQueryInterface();
    let table: Record<string, unknown>;
    let tableName = 'notifications';
    try {
      table = (await qi.describeTable(tableName)) as Record<string, unknown>;
    } catch {
      try {
        tableName = 'Notifications';
        table = (await qi.describeTable(tableName)) as Record<string, unknown>;
      } catch {
        return;
      }
    }

    const add = async (name: string, definition: Parameters<typeof qi.addColumn>[2]) => {
      if (table[name]) return;
      await qi.addColumn(tableName, name, definition);
      table[name] = definition;
    };

    await add('category', {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: 'SYSTEM',
    });
    await add('priority', {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'NORMAL',
    });
    await add('entityId', { type: DataTypes.STRING, allowNull: true });
    await add('entityType', { type: DataTypes.STRING(60), allowNull: true });
    await add('senderId', { type: DataTypes.STRING, allowNull: true });

    const indexes = (await sequelize.query(
      `SHOW INDEX FROM \`${tableName}\``,
      { type: QueryTypes.SELECT }
    )) as Array<{ Key_name?: string }>;
    const names = new Set(indexes.map((i) => String(i.Key_name || '')));
    if (
      !names.has('notifications_user_created_at') &&
      !names.has('notifications_user_id_created')
    ) {
      await qi.addIndex(tableName, ['userId', 'createdAt'], {
        name: 'notifications_user_created_at',
      });
    }
    if (!names.has('notifications_user_category')) {
      await qi.addIndex(tableName, ['userId', 'category'], {
        name: 'notifications_user_category',
      });
    }
  })().catch((error) => {
    ready = null;
    console.warn('[notification] schema upgrade skipped:', (error as Error)?.message || error);
  });
  return ready;
}

