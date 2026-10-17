/**
 * Map Sequelize model names to MySQL table names (lowercase, no underscores).
 * Matches tables created by mysqldump / export-mysql.ts on XAMPP and Aiven.
 */
export function modelNameToTableName(modelName: string): string {
  const parts = modelName.match(/[A-Z][a-z]*|[A-Z]+(?![a-z])/g);
  if (!parts?.length) return modelName.toLowerCase();
  const base = parts.map((p) => p.toLowerCase()).join('');
  if (base.endsWith('history')) return `${base.slice(0, -7)}histories`;
  if (base.endsWith('y')) return `${base.slice(0, -1)}ies`;
  if (base.endsWith('s') || base.endsWith('x') || base.endsWith('ch') || base.endsWith('sh')) {
    return `${base}es`;
  }
  return `${base}s`;
}
