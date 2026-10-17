import { Router } from 'express';
import {
  listAllowanceTypes,
  upsertAllowanceType,
  listAllowanceRules,
  upsertAllowanceRule,
  deleteAllowanceRule,
  listEmployeeAllowanceAssignments,
  upsertEmployeeAllowanceAssignment,
  listAllowanceTemplates,
  upsertAllowanceTemplate,
  deleteAllowanceTemplate,
  simulatePayrollAllowances,
  assignAllowancePackage,
  previewAllowancePackage,
} from './allowanceRuleService.js';
import { listAllowanceAuditLogsFromAudit } from './auditLogConsolidationService.js';

/** Sequelize model or already-plain DTO → JSON-safe object. */
function toPlainRow(row: unknown): unknown {
  if (row == null) return null;
  if (typeof (row as { get?: unknown }).get === 'function') {
    return (row as { get: (opts: { plain: boolean }) => unknown }).get({ plain: true });
  }
  return row;
}

function sendAllowanceError(res: import('express').Response, e: unknown): void {
  const err = e as Error & { statusCode?: number; code?: string };
  const status =
    err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 400;
  res.status(status).json({ message: err.message || 'Request failed', code: err.code });
}

export function createAllowanceRoutes(
  hrAccess: ReturnType<typeof Router> extends Router ? any : any,
  requireEffectivePermission: (perm: string) => any
): Router {
  const router = Router();

  router.get('/allowances/types', hrAccess, async (_req, res) => {
    try {
      res.json(await listAllowanceTypes());
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/allowances/types', hrAccess, async (req, res) => {
    try {
      const row = await upsertAllowanceType(req.body, req.user?.id);
      res.status(201).json(toPlainRow(row));
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.put('/allowances/types/:id', hrAccess, async (req, res) => {
    try {
      const row = await upsertAllowanceType({ ...req.body, id: req.params.id }, req.user?.id);
      res.json(toPlainRow(row));
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.get('/allowances/rules', hrAccess, async (req, res) => {
    try {
      const allowance_type_id = req.query.allowance_type_id
        ? String(req.query.allowance_type_id)
        : undefined;
      res.json(await listAllowanceRules({ allowance_type_id }));
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/allowances/rules', hrAccess, async (req, res) => {
    try {
      const row = await upsertAllowanceRule(req.body, req.user?.id);
      res.status(201).json(toPlainRow(row));
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.put('/allowances/rules/:id', hrAccess, async (req, res) => {
    try {
      const row = await upsertAllowanceRule({ ...req.body, id: req.params.id }, req.user?.id);
      res.json(toPlainRow(row));
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.delete('/allowances/rules/:id', hrAccess, async (req, res) => {
    try {
      await deleteAllowanceRule(req.params.id, req.user?.id);
      res.json({ success: true });
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.get('/employees/:id/allowances', hrAccess, async (req, res) => {
    try {
      res.json(await listEmployeeAllowanceAssignments(req.params.id));
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.post('/employees/:id/allowances', hrAccess, async (req, res) => {
    try {
      const row = await upsertEmployeeAllowanceAssignment(
        req.params.id,
        req.body,
        req.user?.id
      );
      res.status(201).json(toPlainRow(row));
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.get('/allowances/templates', hrAccess, async (_req, res) => {
    try {
      res.json(await listAllowanceTemplates());
    } catch (e) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/allowances/templates', hrAccess, async (req, res) => {
    try {
      const row = await upsertAllowanceTemplate(req.body, req.user?.id);
      res.status(201).json(toPlainRow(row));
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.put('/allowances/templates/:id', hrAccess, async (req, res) => {
    try {
      const row = await upsertAllowanceTemplate(
        { ...req.body, id: req.params.id },
        req.user?.id
      );
      res.json(toPlainRow(row));
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.delete('/allowances/templates/:id', hrAccess, async (req, res) => {
    try {
      await deleteAllowanceTemplate(req.params.id, req.user?.id);
      res.json({ success: true });
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.post('/payroll/allowances/preview', hrAccess, async (req, res) => {
    try {
      const body = req.body ?? {};
      const result = await previewAllowancePackage({
        allowanceTemplateId: body.allowanceTemplateId ?? body.allowance_template_id ?? null,
        baseSalary: Number(body.baseSalary ?? body.base_salary ?? 0),
        joinDate: body.joinDate ?? body.join_date ?? null,
        departmentId: body.departmentId ?? body.department_id ?? null,
        positionId: body.positionId ?? body.position_id ?? null,
        accessRole: body.accessRole ?? body.access_role ?? body.role ?? 'EMPLOYEE',
        employeeId: body.employeeId ?? body.employee_id ?? undefined,
        month: body.month ? String(body.month) : undefined,
        workHours: body.workHours != null ? Number(body.workHours) : undefined,
        gracePeriodMinutes:
          body.gracePeriodMinutes != null ? Number(body.gracePeriodMinutes) : undefined,
        userId: body.userId ?? body.user_id ?? undefined,
      });
      res.json({ result });
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.put('/employees/:id/allowance-package', hrAccess, async (req, res) => {
    try {
      const templateId = req.body?.allowanceTemplateId ?? req.body?.allowance_template_id ?? null;
      const out = await assignAllowancePackage(
        req.params.id,
        templateId ? String(templateId) : null,
        req.user?.id
      );
      res.json(out);
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.post('/payroll/simulate', hrAccess, async (req, res) => {
    try {
      const { employeeId, month, salesAmount, userId } = req.body ?? {};
      if (!employeeId || !month) {
        res.status(400).json({ message: 'employeeId and month are required' });
        return;
      }
      const out = await simulatePayrollAllowances({
        employeeId: String(employeeId),
        month: String(month),
        salesAmount: salesAmount != null ? Number(salesAmount) : undefined,
        userId: userId ? String(userId) : undefined,
      });
      res.json(out);
    } catch (e) {
      sendAllowanceError(res, e);
    }
  });

  router.get('/allowances/audit', hrAccess, async (req, res) => {
    try {
      const rows = await listAllowanceAuditLogsFromAudit({
        limit: Math.min(Number(req.query.limit) || 50, 200),
      });
      res.json(rows);
    } catch (e) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  return router;
}
