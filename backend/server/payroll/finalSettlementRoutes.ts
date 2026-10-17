import type { Router, Request, Response } from 'express';
import {
  calculateFinalSettlementPreview,
  createFinalSettlementRun,
  getFinalSettlementById,
  getFinalSettlementPrefill,
  listFinalSettlementEligibleEmployees,
  listFinalSettlements,
  updateDraftFinalSettlement,
} from './finalSettlementService.js';
import { transitionFinalSettlement } from './finalSettlementWorkflow.js';
import { getProrationConfig } from './prorationConfigService.js';

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

export function mountFinalSettlementRoutes(router: Router, deps: Deps): void {
  const { hrAccess, requirePerm } = deps;

  router.get('/payroll/proration-config', hrAccess, async (_req, res) => {
    try {
      res.json(await getProrationConfig());
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/final-settlements', hrAccess, async (req, res) => {
    try {
      res.json(
        await listFinalSettlements({
          employeeId: req.query.employeeId as string | undefined,
          status: req.query.status as string | undefined,
        })
      );
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/final-settlements/prefill/:employeeId', hrAccess, async (req, res) => {
    try {
      const lastWorkingDate = String(req.query.lastWorkingDate ?? '').trim() || undefined;
      res.json(
        await getFinalSettlementPrefill(req.params.employeeId, {
          lastWorkingDateOverride: lastWorkingDate,
        })
      );
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/final-settlements/eligible-employees', hrAccess, async (_req, res) => {
    try {
      res.json(await listFinalSettlementEligibleEmployees());
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.get('/payroll/final-settlements/:id', hrAccess, async (req, res) => {
    try {
      res.json(await getFinalSettlementById(req.params.id));
    } catch (err) {
      sendErr(res, err);
    }
  });

  router.post(
    '/payroll/final-settlements/preview',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        res.json(
          await calculateFinalSettlementPreview({
            employeeDisplayId: String(req.body?.employeeId),
            lastWorkingDate: String(req.body?.lastWorkingDate),
            settlementLines: req.body?.settlementLines,
            leaveEncashmentUsd: Number(req.body?.leaveEncashmentUsd) || 0,
            loanSettlementUsd: Number(req.body?.loanSettlementUsd) || 0,
            assetPenaltyUsd: Number(req.body?.assetPenaltyUsd) || 0,
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/final-settlements/simplified',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const { createSimplifiedOffboardingSettlement } = await import(
          './simplifiedOffboardingService.js'
        );
        res.status(201).json(
          await createSimplifiedOffboardingSettlement({
            employeeDisplayId: String(req.body?.employeeId),
            lastWorkingDate: String(req.body?.lastWorkingDate),
            clearance: req.body?.clearance ?? {},
            createdBy: actorId(req),
            notes: req.body?.notes,
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/final-settlements/:id/simplified-payment',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const { completeSimplifiedOffboardingPayment } = await import(
          './simplifiedOffboardingService.js'
        );
        const decision = String(req.body?.decision ?? '').toUpperCase();
        if (decision !== 'PAY' && decision !== 'NO_PAY') {
          return res.status(400).json({ message: 'decision must be PAY or NO_PAY' });
        }
        res.json(
          await completeSimplifiedOffboardingPayment({
            settlementId: req.params.id,
            decision,
            actorUserId: actorId(req),
            notes: req.body?.notes,
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/final-settlements',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        const result = await createFinalSettlementRun({
          employeeDisplayId: String(req.body?.employeeId),
          lastWorkingDate: String(req.body?.lastWorkingDate),
          finalSettlementDate: req.body?.finalSettlementDate,
          paymentDate: req.body?.paymentDate,
          clearance: req.body?.clearance ?? {},
          settlementLines: req.body?.settlementLines,
          leaveEncashmentUsd: Number(req.body?.leaveEncashmentUsd) || 0,
          loanSettlementUsd: Number(req.body?.loanSettlementUsd) || 0,
          assetPenaltyUsd: Number(req.body?.assetPenaltyUsd) || 0,
          createdBy: actorId(req),
          notes: req.body?.notes,
        });
        res.status(201).json(result);
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.patch(
    '/payroll/final-settlements/:id',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        res.json(
          await updateDraftFinalSettlement(req.params.id, {
            lastWorkingDate: String(req.body?.lastWorkingDate),
            finalSettlementDate: req.body?.finalSettlementDate,
            paymentDate: req.body?.paymentDate,
            clearance: req.body?.clearance ?? {},
            settlementLines: req.body?.settlementLines,
            leaveEncashmentUsd: Number(req.body?.leaveEncashmentUsd) || 0,
            loanSettlementUsd: Number(req.body?.loanSettlementUsd) || 0,
            assetPenaltyUsd: Number(req.body?.assetPenaltyUsd) || 0,
            notes: req.body?.notes,
            updatedBy: actorId(req),
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );

  router.post(
    '/payroll/final-settlements/:id/transition',
    hrAccess,
    requirePerm('hr.payroll.process'),
    async (req, res) => {
      try {
        res.json(
          await transitionFinalSettlement({
            settlementId: req.params.id,
            action: req.body?.action,
            actorUserId: actorId(req),
            reason: req.body?.reason,
            clearance: req.body?.clearance,
            payment: req.body?.payment,
            acknowledgePaymentVariance: Boolean(req.body?.acknowledgePaymentVariance),
          })
        );
      } catch (err) {
        sendErr(res, err);
      }
    }
  );
}
