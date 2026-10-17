import type { Router, Request, Response } from 'express';
import {
  getHistoricalRecordsSummary,
  listHistoricalAttendancePeriods,
  listHistoricalFinalSettlements,
  listHistoricalOffboarding,
  listHistoricalPayrollAudit,
  listHistoricalSalaryChanges,
} from './historicalRecordsService.js';

type Deps = {
  hrAccess: (req: Request, res: Response, next: () => void) => void;
};

function parseLimit(raw: unknown): number {
  const n = parseInt(String(raw ?? '100'), 10);
  if (!Number.isFinite(n) || n < 1) return 100;
  return Math.min(n, 500);
}

function sendErr(res: Response, err: unknown) {
  const e = err as Error & { statusCode?: number };
  res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
}

export function mountHistoricalRecordsRoutes(router: Router, deps: Deps): void {
  const { hrAccess } = deps;

  router.get('/payroll/records/summary', hrAccess, async (_req, res) => {
    try {
      res.json(await getHistoricalRecordsSummary());
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/records/final-settlements', hrAccess, async (req, res) => {
    try {
      res.json(await listHistoricalFinalSettlements(parseLimit(req.query.limit)));
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/records/salary-history', hrAccess, async (req, res) => {
    try {
      res.json(await listHistoricalSalaryChanges(parseLimit(req.query.limit)));
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/records/attendance-periods', hrAccess, async (req, res) => {
    try {
      res.json(await listHistoricalAttendancePeriods(parseLimit(req.query.limit)));
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/records/offboarding', hrAccess, async (req, res) => {
    try {
      res.json(await listHistoricalOffboarding(parseLimit(req.query.limit)));
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/records/audit', hrAccess, async (req, res) => {
    try {
      res.json(await listHistoricalPayrollAudit(parseLimit(req.query.limit)));
    } catch (err) {
      sendErr(res, err);
    }
  });
}
