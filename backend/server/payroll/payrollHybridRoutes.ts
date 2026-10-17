import type { Router, Request, Response } from 'express';
import {
  finalizeAttendancePeriod,
  getAttendancePeriod,
  reopenAttendancePeriod,
} from './attendanceFinalizationService.js';
import {
  approvePayrollAdjustment,
  createPayrollAdjustment,
  listPayrollAdjustments,
} from './payrollAdjustmentService.js';
import {
  createPaymentBatchForRun,
  exportPaymentBatch,
  listPaymentBatches,
} from './paymentBatchService.js';
import { transitionPayrollRun } from './payrollWorkflowService.js';
import { listPayrollAuditLogsFromAudit } from '../auditLogConsolidationService.js';
import { manualFreezeFromCalendar } from './attendanceFreezeScheduler.js';
import { createAttendanceAmendment } from './attendanceAmendmentService.js';

type Deps = {
  hrAccess: (req: Request, res: Response, next: () => void) => void;
  requirePerm: (key: string) => (req: Request, res: Response, next: () => void) => void;
};

function actorId(req: Request): string {
  const u = (req as any).user;
  return String(u?.id ?? u?.userId ?? 'system');
}

function sendErr(res: Response, err: unknown) {
  const e = err as Error & { statusCode?: number; code?: string };
  res.status(e.statusCode ?? 500).json({
    message: e.message || 'Internal server error',
    ...(e.code ? { code: e.code } : {}),
  });
}

export function mountPayrollHybridRoutes(router: Router, deps: Deps): void {
  const { hrAccess, requirePerm } = deps;

  router.post(
    '/payroll/calendar/:month/freeze',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const groupId = String(req.body?.payrollGroupId ?? 'default');
        await manualFreezeFromCalendar(req.params.month, actorId(req), groupId);
        res.json(await getAttendancePeriod(req.params.month, groupId));
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/attendance-amendments',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const row = await createAttendanceAmendment({
          userId: String(req.body?.userId),
          workDate: String(req.body?.workDate),
          description: String(req.body?.description ?? ''),
          proposedChanges: req.body?.proposedChanges ?? {},
          originalValues: req.body?.originalValues,
          createdBy: actorId(req),
          amountUsd: Number(req.body?.amountUsd) || 0,
          payrollGroupId: req.body?.payrollGroupId,
        });
        res.status(201).json(row);
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.get('/payroll/attendance-periods/:month', hrAccess, async (req, res) => {
    try {
      const groupId = String(req.query.payrollGroupId ?? 'default');
      res.json(await getAttendancePeriod(req.params.month, groupId));
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.post(
    '/payroll/attendance-periods/:month/finalize',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const result = await finalizeAttendancePeriod(
          req.params.month,
          actorId(req),
          req.body?.notes,
          String(req.body?.payrollGroupId ?? req.query.payrollGroupId ?? 'default')
        );
        res.json(result);
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/attendance-periods/:month/reopen',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        await reopenAttendancePeriod(req.params.month, actorId(req));
        res.json(await getAttendancePeriod(req.params.month));
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.get('/payroll/adjustments', hrAccess, async (req, res) => {
    try {
      res.json(
        await listPayrollAdjustments({
          month: req.query.month as string | undefined,
          payrollRunId: req.query.payrollRunId as string | undefined,
          userId: req.query.userId as string | undefined,
          status: req.query.status as string | undefined,
        })
      );
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.post(
    '/payroll/adjustments',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const row = await createPayrollAdjustment({
          userId: String(req.body?.userId),
          month: String(req.body?.month),
          adjustmentType: req.body?.adjustmentType,
          amountUsd: Number(req.body?.amountUsd) || 0,
          description: req.body?.description,
          payrollRunId: req.body?.payrollRunId,
          payslipId: req.body?.payslipId,
          oldValues: req.body?.oldValues,
          newValues: req.body?.newValues,
          createdBy: actorId(req),
        });
        res.status(201).json(row);
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/adjustments/:id/approve',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        res.json(await approvePayrollAdjustment(req.params.id, actorId(req)));
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.get('/payroll/payment-batches', hrAccess, async (req, res) => {
    try {
      res.json(await listPaymentBatches(req.query.payrollRunId as string | undefined));
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.post(
    '/payroll/runs/:id/payment-batches',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        res.status(201).json(await createPaymentBatchForRun(req.params.id, actorId(req)));
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/payment-batches/:id/export',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        res.json(await exportPaymentBatch(req.params.id, actorId(req)));
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/payment-batches/:id/reconcile',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const { reconcilePaymentBatch } = await import('./paymentBatchService.js');
        res.json(await reconcilePaymentBatch(req.params.id, actorId(req)));
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.get('/payroll/payments/runs', hrAccess, requirePerm('hr.payroll.view'), async (_req, res) => {
    try {
      const { listPayrollPaymentRuns } = await import('./payslipDisbursementService.js');
      res.json(await listPayrollPaymentRuns());
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/payments/queue', hrAccess, requirePerm('hr.payroll.view'), async (req, res) => {
    try {
      const runId = String(req.query.runId ?? '').trim();
      if (!runId) {
        return res.status(400).json({ message: 'runId query parameter is required.' });
      }
      const { listPayrollPaymentQueue } = await import('./payslipDisbursementService.js');
      res.json(await listPayrollPaymentQueue(runId));
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.patch(
    '/payroll/payslips/:id/disbursement',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const status = String(req.body?.status ?? '').toUpperCase();
        if (!['PENDING', 'PAID', 'HOLDING'].includes(status)) {
          return res.status(400).json({ message: 'status must be PENDING, PAID, or HOLDING.' });
        }
        const { setPayslipDisbursementStatus } = await import('./payslipDisbursementService.js');
        res.json(
          await setPayslipDisbursementStatus({
            payslipId: req.params.id,
            status: status as 'PENDING' | 'PAID' | 'HOLDING',
            actorUserId: actorId(req),
            holdNote: req.body?.holdNote ?? req.body?.note ?? null,
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/runs/:id/submit-review',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        await transitionPayrollRun({
          runId: req.params.id,
          toStatus: 'UNDER_REVIEW',
          actorUserId: actorId(req),
        });
        res.json({ success: true });
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/runs/:id/lock',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        await transitionPayrollRun({
          runId: req.params.id,
          toStatus: 'LOCKED',
          actorUserId: actorId(req),
        });
        res.json({ success: true });
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.get('/payroll/audit-logs', hrAccess, async (req, res) => {
    try {
      const entityType = req.query.entityType as string | undefined;
      const entityId = req.query.entityId as string | undefined;
      const rows = await listPayrollAuditLogsFromAudit({
        entityType,
        entityId,
        limit: Math.min(Number(req.query.limit) || 100, 500),
      });
      res.json(rows);
    } catch (err) {
      sendErr(res, err);
    }
  });
}
