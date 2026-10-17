import type { Router, Request, Response } from 'express';
import {
  appendInvestigationEntry,
  confirmAbsconded,
  getAbandonmentCaseForEmployee,
  listAbandonmentCases,
  markUnderInvestigation,
  offboardWithSeparationType,
} from './abandonmentCaseService.js';
import {
  createDeductionAuthorization,
  listDeductionAuthorizations,
  transitionDeductionAuthorization,
} from './authorizedDeductionService.js';
import {
  getAbandonmentPolicy,
  updateAbandonmentPolicy,
} from './abandonmentPolicyService.js';
import { countConsecutiveUnapprovedAbsences, scanEmployeeForConsecutiveAbsence } from './consecutiveAbsenceService.js';
import { computeLastValidWorkingDate } from './lastValidWorkingDateService.js';
import {
  reportAbscondedEmployees,
  reportConsecutiveAbsenceAlerts,
  reportFinalSettlementSummary,
  reportOutstandingDeductions,
  reportResignationWithoutNotice,
} from './abandonmentReports.js';
import { normalizeSeparationType, SEPARATION_RULES } from './separationTypes.js';
import { resolvePortalUserForEmployee } from './finalSettlementService.js';
import type { AbsencePeriod } from './consecutiveAbsenceService.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseAbandonmentPeriod(
  dateFromRaw: unknown,
  dateToRaw: unknown
): { period?: AbsencePeriod; error?: string } {
  const dateFrom =
    typeof dateFromRaw === 'string' ? dateFromRaw.trim().slice(0, 10) : '';
  const dateTo = typeof dateToRaw === 'string' ? dateToRaw.trim().slice(0, 10) : '';
  if (!dateFrom && !dateTo) return {};
  if (!dateFrom || !dateTo) {
    return { error: 'Provide both dateFrom and dateTo, or omit both for the default window.' };
  }
  if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo)) {
    return { error: 'dateFrom and dateTo must be valid YYYY-MM-DD dates.' };
  }
  if (dateFrom > dateTo) {
    return { error: 'dateFrom must be on or before dateTo.' };
  }
  return { period: { dateFrom, dateTo } };
}

function periodFromQuery(req: Request): { period?: AbsencePeriod; error?: string } {
  return parseAbandonmentPeriod(req.query.dateFrom, req.query.dateTo);
}

function periodFromBody(req: Request): { period?: AbsencePeriod; error?: string } {
  return parseAbandonmentPeriod(req.body?.dateFrom ?? req.body?.date_from, req.body?.dateTo ?? req.body?.date_to);
}

type Deps = {
  hrAccess: (req: Request, res: Response, next: () => void) => void;
  requirePerm: (key: string) => (req: Request, res: Response, next: () => void) => void;
};

function actorId(req: Request): string {
  return String((req as any).user?.id ?? 'system');
}

function sendErr(res: Response, err: unknown) {
  const e = err as Error & { statusCode?: number };
  res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
}

export function mountAbandonmentRoutes(router: Router, deps: Deps): void {
  const { hrAccess, requirePerm } = deps;

  router.get('/hr/abandonment/policy', hrAccess, async (_req, res) => {
    try {
      res.json(await getAbandonmentPolicy());
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.patch(
    '/hr/abandonment/policy',
    hrAccess,
    requirePerm('hr.employee.offboard'),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const updated = await updateAbandonmentPolicy({
          defaultThreshold: body.defaultThreshold,
          autoFlagEnabled: body.autoFlagEnabled,
        });
        res.json(updated);
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.get('/hr/abandonment/separation-types', hrAccess, (_req, res) => {
    res.json(Object.values(SEPARATION_RULES));
  });

  router.get('/hr/abandonment/cases', hrAccess, async (req, res) => {
    try {
      res.json(
        await listAbandonmentCases({
          status: req.query.status as string | undefined,
          employeeId: req.query.employeeId as string | undefined,
        })
      );
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/hr/abandonment/cases/employee/:employeeId', hrAccess, async (req, res) => {
    try {
      res.json(await getAbandonmentCaseForEmployee(req.params.employeeId));
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.post(
    '/hr/abandonment/cases/:caseId/investigate',
    hrAccess,
    requirePerm('hr.employee.offboard'),
    async (req, res) => {
      try {
        res.json(
          await markUnderInvestigation({
            caseId: req.params.caseId,
            actorUserId: actorId(req),
            reason: req.body?.reason,
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/hr/abandonment/cases/:caseId/notes',
    hrAccess,
    requirePerm('hr.employee.offboard'),
    async (req, res) => {
      try {
        res.json(
          await appendInvestigationEntry({
            caseId: req.params.caseId,
            actorUserId: actorId(req),
            note: String(req.body?.note ?? ''),
            type: req.body?.type ?? 'note',
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/hr/abandonment/cases/:caseId/absconded',
    hrAccess,
    requirePerm('hr.employee.offboard'),
    async (req, res) => {
      try {
        res.json(
          await confirmAbsconded({
            caseId: req.params.caseId,
            actorUserId: actorId(req),
            reason: String(req.body?.reason ?? ''),
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/hr/abandonment/employees/:employeeId/separate',
    hrAccess,
    requirePerm('hr.employee.offboard'),
    async (req, res) => {
      try {
        const separationType = normalizeSeparationType(req.body?.separationType);
        if (!separationType) {
          return res.status(400).json({ message: 'Invalid separationType' });
        }
        res.json(
          await offboardWithSeparationType({
            displayEmployeeId: req.params.employeeId,
            separationType,
            reason: String(req.body?.reason ?? ''),
            offboardedBy: actorId(req),
            lastWorkingDate: req.body?.lastWorkingDate,
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.get('/hr/abandonment/employees/:employeeId/consecutive-absences', hrAccess, async (req, res) => {
    try {
      const { period, error } = periodFromQuery(req);
      if (error) return res.status(400).json({ message: error });
      const portal = await resolvePortalUserForEmployee(req.params.employeeId);
      if (!portal) return res.status(404).json({ message: 'Employee portal user not found' });
      const count = await countConsecutiveUnapprovedAbsences(
        portal.userId,
        period?.dateTo,
        period
      );
      res.json({
        count,
        userId: portal.userId,
        ...(period ? { dateFrom: period.dateFrom, dateTo: period.dateTo } : {}),
      });
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.post(
    '/hr/abandonment/employees/:employeeId/scan-absence',
    hrAccess,
    requirePerm('hr.employee.offboard'),
    async (req, res) => {
      try {
        const { period, error } = periodFromBody(req);
        if (error) return res.status(400).json({ message: error });
        const portal = await resolvePortalUserForEmployee(req.params.employeeId);
        if (!portal) return res.status(404).json({ message: 'Employee portal user not found' });
        res.json(
          await scanEmployeeForConsecutiveAbsence({
            userId: portal.userId,
            payrollGroupId: req.body?.payrollGroupId,
            period,
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.get('/hr/abandonment/employees/:employeeId/last-valid-working-date', hrAccess, async (req, res) => {
    try {
      const { period, error } = periodFromQuery(req);
      if (error) return res.status(400).json({ message: error });
      const portal = await resolvePortalUserForEmployee(req.params.employeeId);
      if (!portal) return res.status(404).json({ message: 'Employee portal user not found' });
      const result = await computeLastValidWorkingDate({
        userId: portal.userId,
        dateFrom: period?.dateFrom,
        dateTo: period?.dateTo,
      });
      res.json({
        ...result,
        ...(period ? { dateFrom: period.dateFrom, dateTo: period.dateTo } : {}),
      });
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/hr/abandonment/deductions', hrAccess, async (req, res) => {
    try {
      res.json(
        await listDeductionAuthorizations({
          employeeId: req.query.employeeId as string | undefined,
          status: req.query.status as string | undefined,
        })
      );
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.post(
    '/hr/abandonment/deductions',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const portal = await resolvePortalUserForEmployee(String(req.body?.employeeId));
        if (!portal) return res.status(404).json({ message: 'Employee portal user not found' });
        res.json(
          await createDeductionAuthorization({
            employeeId: String(req.body?.employeeId),
            separationType: normalizeSeparationType(req.body?.separationType) ?? undefined,
            deductionCode: req.body?.deductionCode,
            deductionLabel: String(req.body?.deductionLabel ?? req.body?.deductionCode),
            amountUsd: Number(req.body?.amountUsd),
            reason: String(req.body?.reason ?? ''),
            createdBy: actorId(req),
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/hr/abandonment/deductions/:id/:action',
    hrAccess,
    requirePerm('hr.payroll.approve'),
    async (req, res) => {
      try {
        const action = req.params.action === 'approve' ? 'approve' : 'reject';
        res.json(
          await transitionDeductionAuthorization({
            id: req.params.id,
            action,
            actorUserId: actorId(req),
            reason: req.body?.reason,
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.get('/hr/abandonment/reports/absconded', hrAccess, async (_req, res) => {
    try {
      res.json(await reportAbscondedEmployees());
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/hr/abandonment/reports/no-notice-resignations', hrAccess, async (_req, res) => {
    try {
      res.json(await reportResignationWithoutNotice());
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/hr/abandonment/reports/consecutive-absence-alerts', hrAccess, async (_req, res) => {
    try {
      res.json(await reportConsecutiveAbsenceAlerts());
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/hr/abandonment/reports/final-settlements', hrAccess, async (_req, res) => {
    try {
      res.json(await reportFinalSettlementSummary());
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/hr/abandonment/reports/outstanding-deductions', hrAccess, async (_req, res) => {
    try {
      res.json(await reportOutstandingDeductions());
    } catch (err) {
      sendErr(res, err);
    }
  });
}
