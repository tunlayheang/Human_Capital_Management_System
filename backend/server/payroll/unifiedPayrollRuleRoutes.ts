import { Router } from 'express';
import {
  deleteUnifiedPayrollRule,
  detectUnifiedRuleConflicts,
  evaluateUnifiedRulesPreview,
  getUnifiedPayrollRule,
  listUnifiedPayrollRules,
  listUnifiedRuleLogsForEmployee,
  previewPayrollRuleImpact,
  upsertUnifiedPayrollRule,
} from './unifiedPayrollRuleService.js';

export function createUnifiedPayrollRuleRoutes(hrAccess: any): Router {
  const router = Router();

  router.get('/rules', hrAccess, async (req, res) => {
    try {
      const category = req.query.category ? String(req.query.category) : undefined;
      const templatesOnly = req.query.templates === '1';
      const activeOnly = req.query.active === '1';
      res.json(
        await listUnifiedPayrollRules({
          category: category as Parameters<typeof listUnifiedPayrollRules>[0]['category'],
          templatesOnly,
          activeOnly,
        })
      );
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/rules/conflicts', hrAccess, async (_req, res) => {
    try {
      res.json(await detectUnifiedRuleConflicts());
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/rules/:id', hrAccess, async (req, res) => {
    try {
      const row = await getUnifiedPayrollRule(req.params.id);
      if (!row) return res.status(404).json({ message: 'Rule not found' });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/rules', hrAccess, async (req, res) => {
    try {
      const row = await upsertUnifiedPayrollRule(req.body, req.user?.id);
      res.status(201).json(row);
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.put('/rules/:id', hrAccess, async (req, res) => {
    try {
      const row = await upsertUnifiedPayrollRule({ ...req.body, id: req.params.id }, req.user?.id);
      res.json(row);
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.delete('/rules/:id', hrAccess, async (req, res) => {
    try {
      await deleteUnifiedPayrollRule(req.params.id);
      res.status(204).send();
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.post('/rules/evaluate', hrAccess, async (req, res) => {
    try {
      res.json(await evaluateUnifiedRulesPreview(req.body));
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.post('/rules/preview', hrAccess, async (req, res) => {
    try {
      res.json(await previewPayrollRuleImpact(req.body));
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.get('/rules/logs/:employeeId', hrAccess, async (req, res) => {
    try {
      const month = req.query.month ? String(req.query.month) : undefined;
      res.json(await listUnifiedRuleLogsForEmployee(req.params.employeeId, { month }));
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  return router;
}
