import { Router } from 'express';
import { requireEffectivePermission } from '../middleware/permissions.js';
import { getCatalog, runReport, ReportValidationError } from './reportRunner.js';

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const sequelizeMsg =
      (error as { parent?: { sqlMessage?: string }; original?: { sqlMessage?: string } }).parent
        ?.sqlMessage ||
      (error as { original?: { sqlMessage?: string } }).original?.sqlMessage;
    if (sequelizeMsg) return sequelizeMsg;
    return error.message || 'Internal server error';
  }
  return 'Internal server error';
}

function coerceFilters(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue;
    if (typeof value === 'object') continue;
    out[key] = String(value);
  }
  return out;
}

export function createReportCatalogRoutes(): Router {
  const router = Router();

  router.get('/catalog', requireEffectivePermission('reports.view'), (_req, res) => {
    try {
      res.json({ reports: getCatalog() });
    } catch (error) {
      console.error('[reports/catalog]', error);
      res.status(500).json({ message: errorMessage(error) });
    }
  });

  router.post('/run', requireEffectivePermission('reports.view'), async (req, res) => {
    try {
      const reportId = String(req.body?.reportId || '').trim();
      if (!reportId) {
        return res.status(400).json({ message: 'reportId is required' });
      }
      const filters =
        req.body?.filters && typeof req.body.filters === 'object' && !Array.isArray(req.body.filters)
          ? coerceFilters(req.body.filters as Record<string, unknown>)
          : {};
      const actorUserId = String((req as { user?: { id?: string } }).user?.id || '');
      const result = await runReport(reportId, filters, { actorUserId });
      // Ensure JSON-safe payload (no Decimal/Date oddities).
      res.json(JSON.parse(JSON.stringify(result)));
    } catch (error) {
      if (error instanceof ReportValidationError) {
        return res.status(error.status || 400).json({ message: error.message });
      }
      console.error('[reports/run]', error);
      res.status(500).json({ message: errorMessage(error) });
    }
  });

  return router;
}
