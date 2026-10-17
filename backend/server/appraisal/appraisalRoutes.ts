import type { Router, Request, Response, NextFunction } from 'express';
import { requireEffectivePermission } from '../middleware/permissions.js';

type HrAccess = (req: Request, res: Response, next: NextFunction) => void;

export function mountAppraisalRoutes(router: Router, hrAccess: HrAccess): void {
  const manage = [
    hrAccess,
    requireEffectivePermission('performance.manage'),
  ] as const;
  const view = [hrAccess, requireEffectivePermission('performance.view')] as const;

  // Runs the HR/manager `manage` permission chain manually so we can fall back
  // to it when an actor is not the current appraisal evaluator.
  const runManageChain = (req: Request, res: Response, next: NextFunction) => {
    let index = 0;
    const run = (err?: unknown) => {
      if (err) return next(err as any);
      const middleware = manage[index++];
      if (!middleware) return next();
      middleware(req, res, run);
    };
    run();
  };

  // Allows the current assigned evaluator (regardless of base role) to act on an
  // appraisal; everyone else must satisfy the `performance.manage` chain.
  const evaluatorOrManage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      if (user?.id) {
        const { isCurrentAppraisalEvaluator } = await import('./appraisalWorkflowService.js');
        if (await isCurrentAppraisalEvaluator(String(req.params.id), String(user.id))) {
          return next();
        }
      }
    } catch {
      /* fall through to the manage chain */
    }
    runManageChain(req, res, next);
  };

  router.get('/appraisal/my-performance', async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.id) return res.status(401).json({ message: 'Not authenticated' });
      const { getMyPerformanceHub } = await import('./employeePerformanceService.js');
      res.json(await getMyPerformanceHub(String(user.id)));
    } catch (e) {
      console.error('my performance hub:', e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/appraisal/my-performance/appraisals/:id', async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.id) return res.status(401).json({ message: 'Not authenticated' });
      const { getMyKpiAppraisalDetail } = await import('./employeePerformanceService.js');
      const detail = await getMyKpiAppraisalDetail(String(user.id), req.params.id);
      if (!detail) return res.status(404).json({ message: 'Appraisal not found' });
      res.json(detail);
    } catch (e) {
      console.error('my performance detail:', e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/appraisal/my-self-evaluations', async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.id) return res.status(401).json({ message: 'Not authenticated' });
      const { listMyPendingAppraisalSelfEvaluations } = await import('./appraisalWorkflowService.js');
      res.json(await listMyPendingAppraisalSelfEvaluations(String(user.id)));
    } catch (e) {
      console.error('my self evaluations:', e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/appraisal/appraisals/:id/self-evaluation', async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.id) return res.status(401).json({ message: 'Not authenticated' });
      const { advanceAppraisalWorkflow } = await import('./appraisalWorkflowService.js');
      const row = await advanceAppraisalWorkflow({
        appraisalId: req.params.id,
        action: 'submit_self_evaluation',
        actorId: user.id,
        actorRole: user.role,
        notes: req.body.notes,
        evaluation: req.body.evaluation ?? {
          strengths: req.body.strengths,
          weaknesses: req.body.weaknesses,
          notes: req.body.notes,
          scores: req.body.scores,
        },
      });
      res.json(row);
    } catch (e: any) {
      res.status(e?.message?.includes('Only') ? 403 : 400).json({
        message: e?.message || 'Self-evaluation submission failed',
      });
    }
  });

  router.get('/appraisal/periods', ...view, async (_req, res) => {
    try {
      const { listAppraisalPeriodsWithUsage } = await import('./appraisalPeriodService.js');
      res.json(await listAppraisalPeriodsWithUsage());
    } catch (e) {
      console.error('appraisal periods list:', e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/appraisal/periods', ...manage, async (req, res) => {
    try {
      const { createAppraisalPeriod } = await import('./appraisalPeriodService.js');
      const user = (req as any).user;
      const row = await createAppraisalPeriod({
        name: req.body.name,
        periodType: req.body.periodType,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        status: req.body.status,
        isActive: req.body.isActive ?? req.body.is_active,
        alertNotificationDate: req.body.alertNotificationDate ?? req.body.alert_notification_date,
        createdBy: user?.id,
      });
      res.status(201).json(row);
      const alertToday =
        row.alert_notification_date &&
        String(row.alert_notification_date).slice(0, 10) ===
          (await import('../payrollRunNotificationService.js')).businessDateKey().slice(0, 10);
      if (alertToday) {
        const { dispatchAppraisalPeriodAlertNotifications } = await import(
          './appraisalPeriodReminderService.js'
        );
        void dispatchAppraisalPeriodAlertNotifications();
      }
    } catch (e: any) {
      res.status(400).json({ message: e?.message || 'Failed to create period' });
    }
  });

  router.put('/appraisal/periods/:id', ...manage, async (req, res) => {
    try {
      const { updateAppraisalPeriod } = await import('./appraisalPeriodService.js');
      const user = (req as any).user;
      const hasAlertField =
        req.body.alertNotificationDate !== undefined ||
        req.body.alert_notification_date !== undefined;
      const hasActiveField =
        req.body.isActive !== undefined || req.body.is_active !== undefined;
      const row = await updateAppraisalPeriod(req.params.id, {
        name: req.body.name,
        periodType: req.body.periodType,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        status: req.body.status,
        performedBy: user?.id ?? null,
        ...(hasActiveField
          ? { isActive: req.body.isActive ?? req.body.is_active }
          : {}),
        ...(hasAlertField
          ? {
              alertNotificationDate:
                req.body.alertNotificationDate ?? req.body.alert_notification_date ?? null,
            }
          : {}),
      });
      if (!row) return res.status(404).json({ message: 'Period not found' });
      res.json(row);
      const { isAppraisalPeriodActive } = await import('./appraisalPeriodService.js');
      const alertToday =
        isAppraisalPeriodActive(row) &&
        row.alert_notification_date &&
        String(row.alert_notification_date).slice(0, 10) ===
          (await import('../payrollRunNotificationService.js')).businessDateKey().slice(0, 10);
      if (alertToday) {
        const { dispatchAppraisalPeriodAlertNotifications } = await import(
          './appraisalPeriodReminderService.js'
        );
        void dispatchAppraisalPeriodAlertNotifications();
      }
    } catch (e: any) {
      res.status(400).json({ message: e?.message || 'Failed to update period' });
    }
  });

  router.delete('/appraisal/periods/:id', ...manage, async (req, res) => {
    try {
      const { deleteAppraisalPeriod } = await import('./appraisalPeriodService.js');
      const user = (req as any).user;
      const result = await deleteAppraisalPeriod(req.params.id, user?.id ?? null);
      res.json({ success: true, ...result });
    } catch (e: any) {
      const status = e?.status === 404 ? 404 : e?.status === 409 ? 409 : 400;
      res.status(status).json({
        message: e?.message || 'Failed to delete period',
        code: e?.code,
      });
    }
  });

  router.get('/appraisal/kpi-components', ...view, async (_req, res) => {
    try {
      const { listKpiComponents, validateComponentWeights } = await import('./kpiComponentService.js');
      const components = await listKpiComponents();
      const weightError = validateComponentWeights(components.filter((c) => Number(c.active) === 1));
      res.json({ components, weightError });
    } catch (e) {
      console.error('kpi components:', e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.put('/appraisal/kpi-components', ...manage, async (req, res) => {
    try {
      const { saveKpiComponents } = await import('./kpiComponentService.js');
      const user = (req as any).user;
      const components = await saveKpiComponents(req.body.components ?? [], user?.id ?? null);
      res.json({ components });
    } catch (e: any) {
      res.status(400).json({ message: e?.message || 'Failed to save components' });
    }
  });

  router.get('/appraisal/attendance-rules', ...view, async (_req, res) => {
    try {
      const { listAttendanceDeductionRules } = await import('./kpiComponentService.js');
      res.json({ rules: await listAttendanceDeductionRules() });
    } catch (e) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.put('/appraisal/attendance-rules', ...manage, async (req, res) => {
    try {
      const { saveAttendanceDeductionRules } = await import('./kpiComponentService.js');
      const user = (req as any).user;
      res.json({
        rules: await saveAttendanceDeductionRules(req.body.rules ?? [], user?.id ?? null),
      });
    } catch (e: any) {
      res.status(400).json({ message: e?.message || 'Failed to save rules' });
    }
  });

  router.get('/appraisal/policy', ...view, async (_req, res) => {
    try {
      const { loadKpiPolicySettings } = await import('./appraisalPolicySettings.js');
      res.json(await loadKpiPolicySettings());
    } catch (e) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.put('/appraisal/policy', ...manage, async (req, res) => {
    try {
      const { saveKpiPolicySettings } = await import('./appraisalPolicySettings.js');
      const user = (req as any).user;
      res.json(await saveKpiPolicySettings(req.body, user?.id ?? null));
    } catch (e: any) {
      res.status(400).json({ message: e?.message || 'Failed to save policy' });
    }
  });

  router.get('/appraisal/recommendation-rules', ...view, async (_req, res) => {
    try {
      const { listRecommendationRules } = await import('./kpiComponentService.js');
      res.json({ rules: await listRecommendationRules() });
    } catch (e) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.put('/appraisal/recommendation-rules', ...manage, async (req, res) => {
    try {
      const { saveRecommendationRules } = await import('./kpiComponentService.js');
      const user = (req as any).user;
      res.json({
        rules: await saveRecommendationRules(req.body.rules ?? [], user?.id ?? null),
      });
    } catch (e: any) {
      res.status(400).json({ message: e?.message || 'Failed to save recommendations' });
    }
  });

  router.get('/appraisal/pending-my-approval', async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.id) return res.status(401).json({ message: 'Not authenticated' });
      const { listFinalAppraisalsForAssignedApprover } = await import(
        './appraisalWorkflowService.js'
      );
      res.json(
        await listFinalAppraisalsForAssignedApprover(
          {
            id: String(user.id),
            role: String(user.role ?? ''),
          },
          { includeHistory: true }
        )
      );
    } catch (e) {
      console.error('list pending appraisal approvals:', e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/appraisal/appraisals', ...view, async (req, res) => {
    try {
      const user = (req as any).user;
      const { listAppraisals } = await import('./appraisalWorkflowService.js');
      res.json(
        await listAppraisals({
          periodId: req.query.periodId as string | undefined,
          userId: req.query.userId as string | undefined,
          workflowStatus: req.query.status as string | undefined,
          actor: user?.id
            ? { userId: String(user.id), role: String(user.role ?? '') }
            : undefined,
        })
      );
    } catch (e) {
      console.error('list appraisals:', e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/appraisal/manager-assignees', ...view, async (req, res) => {
    try {
      const departmentId = req.query.departmentId ? String(req.query.departmentId) : undefined;
      const { listProbationManagerAssignees } = await import(
        '../probation/probationReviewService.js'
      );
      res.json(await listProbationManagerAssignees(departmentId));
    } catch (error) {
      console.error('Error fetching appraisal manager assignees:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/appraisal/appraisals/:id', async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.id) return res.status(401).json({ message: 'Not authenticated' });
      const actor = { userId: String(user.id), role: String(user.role ?? '') };
      const { getAppraisalDetail } = await import('./appraisalWorkflowService.js');
      const detail = await getAppraisalDetail(req.params.id, actor);
      if (!detail) {
        return res.status(403).json({ message: 'You do not have access to this appraisal' });
      }
      res.json(detail);
    } catch (e) {
      console.error('get appraisal detail:', e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/appraisal/appraisals', ...manage, async (req, res) => {
    try {
      const { createOrRefreshAppraisal, bulkCreateAppraisalsForPeriod } =
        await import('./appraisalWorkflowService.js');
      const user = (req as any).user;
      if (req.body.bulkPeriodId) {
        const { created, skipped } = await bulkCreateAppraisalsForPeriod(
          req.body.bulkPeriodId,
          user?.id
        );
        return res.status(201).json({
          created: created.length,
          skipped,
          appraisals: created,
        });
      }
      const row = await createOrRefreshAppraisal({
        userId: req.body.userId,
        periodId: req.body.periodId,
        actorId: user?.id,
        manualScores: req.body.manualScores,
      });
      res.status(201).json(row);
    } catch (e: any) {
      const status = e?.status === 404 ? 404 : e?.status === 409 ? 409 : 400;
      res.status(status).json({ message: e?.message || 'Failed to create appraisal', code: e?.code });
    }
  });

  router.put('/appraisal/appraisals/:id/scores', evaluatorOrManage, async (req, res) => {
    try {
      const { saveManualComponentScores } = await import('./appraisalWorkflowService.js');
      const user = (req as any).user;
      const row = await saveManualComponentScores({
        appraisalId: req.params.id,
        scores: req.body.scores ?? [],
        actorId: user?.id,
        actorRole: user?.role,
      });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e?.message || 'Failed to save scores' });
    }
  });

  router.put('/appraisal/appraisals/:id/evaluation', evaluatorOrManage, async (req, res) => {
    try {
      const { saveAppraisalEvaluation } = await import('./appraisalWorkflowService.js');
      const user = (req as any).user;
      const row = await saveAppraisalEvaluation({
        appraisalId: req.params.id,
        actorId: user?.id,
        actorRole: user?.role,
        strengths: req.body.strengths,
        weaknesses: req.body.weaknesses,
        managerRecommendations: req.body.managerRecommendations,
      });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e?.message || 'Failed to save evaluation' });
    }
  });

  const FINAL_APPROVER_WORKFLOW_ACTIONS = new Set([
    'approve_final',
    'reject_final',
    'return_final',
  ]);

  router.post('/appraisal/appraisals/:id/workflow', async (req, res, next) => {
    const action = String(req.body?.action ?? '');
    if (FINAL_APPROVER_WORKFLOW_ACTIONS.has(action)) {
      return next();
    }
    // The current evaluator (who may not have performance.manage) submits back to HR.
    if (action === 'submit_to_hr') {
      try {
        const user = (req as any).user;
        if (user?.id) {
          const { isCurrentAppraisalEvaluator } = await import('./appraisalWorkflowService.js');
          if (await isCurrentAppraisalEvaluator(String(req.params.id), String(user.id))) {
            return next();
          }
        }
      } catch {
        /* fall through to the manage chain */
      }
    }
    runManageChain(req, res, next);
  }, async (req, res) => {
    try {
      const { advanceAppraisalWorkflow } = await import('./appraisalWorkflowService.js');
      const user = (req as any).user;
      if (!user?.id) return res.status(401).json({ message: 'Not authenticated' });
      const row = await advanceAppraisalWorkflow({
        appraisalId: req.params.id,
        action: req.body.action,
        actorId: user?.id,
        actorRole: user?.role,
        notes: req.body.notes,
        assignedManagerUserId: req.body.assignedManagerUserId,
        assignedEvaluatorUserIds:
          req.body.assignedEvaluatorUserIds ?? req.body.assigned_evaluator_user_ids,
        assignedFinalApproverUserId:
          req.body.assignedFinalApproverUserId ?? req.body.assigned_final_approver_user_id,
        assignedFinalApproverUserIds:
          req.body.assignedFinalApproverUserIds ?? req.body.assigned_final_approver_user_ids,
        evaluation: req.body.evaluation,
      });
      res.json(row);
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      res.status(
        msg.includes('Only') ||
          msg.includes('not authorized') ||
          msg.includes('not your turn') ||
          msg.includes('waiting on another approver')
          ? 403
          : 400
      ).json({
        message: msg || 'Workflow action failed',
      });
    }
  });

  router.get('/appraisal/history/:userId', ...view, async (req, res) => {
    try {
      const { listAppraisalHistory } = await import('./appraisalWorkflowService.js');
      res.json(await listAppraisalHistory(req.params.userId));
    } catch (e) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/appraisal/analytics', ...view, async (req, res) => {
    try {
      const { buildAppraisalAnalytics } = await import('./appraisalAnalyticsService.js');
      res.json(
        await buildAppraisalAnalytics({
          periodId: req.query.periodId as string | undefined,
          departmentId: req.query.departmentId as string | undefined,
        })
      );
    } catch (e) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/appraisal/analytics/employee/:userId', ...view, async (req, res) => {
    try {
      const { buildEmployeeAppraisalTrend } = await import('./appraisalAnalyticsService.js');
      res.json(await buildEmployeeAppraisalTrend(req.params.userId));
    } catch (e) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/appraisal/preview/automatic', ...view, async (req, res) => {
    try {
      const userId = String(req.query.userId ?? '');
      const periodId = String(req.query.periodId ?? '');
      const metric = String(req.query.metric ?? '');
      if (!userId || !periodId) {
        return res.status(400).json({ message: 'userId and periodId required' });
      }
      if (metric === 'ATTENDANCE') {
        const { previewAttendanceKpiForPeriod } = await import('./attendanceKpiCalculator.js');
        return res.json(await previewAttendanceKpiForPeriod(userId, periodId));
      }
      if (metric === 'TASK_COMPLETION') {
        const { previewTaskKpiForPeriod } = await import('./taskKpiCalculator.js');
        return res.json(await previewTaskKpiForPeriod(userId, periodId));
      }
      res.status(400).json({ message: 'Invalid metric' });
    } catch (e: any) {
      res.status(400).json({ message: e?.message || 'Preview failed' });
    }
  });
}
