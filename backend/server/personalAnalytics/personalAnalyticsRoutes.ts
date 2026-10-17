import { Router } from 'express';
import {
  PersonalAnalyticsAccessError,
  resolveAnalyticsTargetUserId,
} from './personalAnalyticsAccess.js';
import { resolvePersonalAnalyticsRange } from './personalAnalyticsDateRange.js';
import { buildPersonalAnalytics } from './personalAnalyticsService.js';
import {
  buildBirthdayInfo,
  buildPersonalHubOverview,
  buildRequestTracker,
  buildWorkRosterForUser,
  createPersonalAlert,
  createPersonalNote,
  deletePersonalAlert,
  deletePersonalNote,
  listPersonalAlerts,
  listPersonalNotes,
  updatePersonalAlert,
  updatePersonalNote,
} from './personalHubService.js';
import {
  DEFAULT_KPI_GRADES,
  loadKpiGradeDefinitions,
  saveKpiGradeDefinitions,
  type KpiGradeDefinition,
} from './kpiGradeSettings.js';
import { requireEffectivePermission } from '../middleware/permissions.js';

const requirePersonalView = requireEffectivePermission('personal.view');

function hubAccessError(e: unknown, res: import('express').Response, label: string): boolean {
  if (e instanceof PersonalAnalyticsAccessError) {
    res.status(e.statusCode).json({ message: e.message });
    return true;
  }
  const status = (e as { status?: number })?.status;
  if (status === 400 || status === 403 || status === 404) {
    res.status(status).json({ message: (e as Error).message });
    return true;
  }
  console.error(label, e);
  res.status(500).json({ message: 'Request failed' });
  return true;
}

export function mountPersonalAnalyticsRoutes(router: Router, hrAccess: unknown): void {
  router.get('/analytics/personal', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string; role?: string } }).user;
      const targetUserId = await resolveAnalyticsTargetUserId(
        viewer,
        req.query.userId as string | undefined
      );
      const range = resolvePersonalAnalyticsRange({
        preset: req.query.preset as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      });
      const payload = await buildPersonalAnalytics(targetUserId, range);
      res.json(payload);
    } catch (e) {
      if (e instanceof PersonalAnalyticsAccessError) {
        return res.status(e.statusCode).json({ message: e.message });
      }
      console.error('[analytics/personal]', e);
      res.status(500).json({ message: 'Failed to load personal analytics' });
    }
  });

  router.get('/analytics/kpi-grades', async (_req, res) => {
    try {
      const grades = await loadKpiGradeDefinitions();
      res.json({ grades });
    } catch (e) {
      console.error('[analytics/kpi-grades]', e);
      res.status(500).json({
        message: 'Failed to load KPI grades',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.put('/analytics/kpi-grades', hrAccess as never, async (req, res) => {
    try {
      const grades = (req.body?.grades ?? DEFAULT_KPI_GRADES) as KpiGradeDefinition[];
      if (!Array.isArray(grades)) {
        return res.status(400).json({ message: 'grades must be an array' });
      }
      await saveKpiGradeDefinitions(grades);
      res.json({ grades: await loadKpiGradeDefinitions() });
    } catch (e) {
      console.error('[analytics/kpi-grades PUT]', e);
      res.status(500).json({
        message: 'Failed to save KPI grades',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get('/analytics/personal-hub/overview', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string; role?: string; employeeId?: string | null } }).user;
      const targetUserId = await resolveAnalyticsTargetUserId(
        viewer,
        req.query.userId as string | undefined
      );
      const overview = await buildPersonalHubOverview(viewer!, targetUserId);
      res.json(overview);
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/overview]')) return;
    }
  });

  router.get('/analytics/personal-hub/birthday', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string; role?: string } }).user;
      const targetUserId = await resolveAnalyticsTargetUserId(
        viewer,
        req.query.userId as string | undefined
      );
      res.json(await buildBirthdayInfo(targetUserId));
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/birthday]')) return;
    }
  });

  router.get('/analytics/personal-hub/work-roster', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string; role?: string } }).user;
      const targetUserId = await resolveAnalyticsTargetUserId(
        viewer,
        req.query.userId as string | undefined
      );
      const month = String(req.query.month || new Date().toISOString().slice(0, 7));
      res.json(await buildWorkRosterForUser(targetUserId, month));
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/work-roster]')) return;
    }
  });

  router.get('/analytics/personal-hub/requests', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string; role?: string; employeeId?: string | null } }).user;
      const targetUserId = await resolveAnalyticsTargetUserId(
        viewer,
        req.query.userId as string | undefined
      );
      const limit = Math.min(80, Math.max(1, Number(req.query.limit) || 40));
      const items = await buildRequestTracker(viewer!, targetUserId, limit);
      res.json({ items });
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/requests]')) return;
    }
  });

  router.get('/analytics/personal-hub/notes', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string } }).user;
      if (!viewer?.id) return res.status(401).json({ message: 'Unauthorized' });
      res.json({ notes: await listPersonalNotes(viewer.id) });
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/notes]')) return;
    }
  });

  router.post('/analytics/personal-hub/notes', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string } }).user;
      if (!viewer?.id) return res.status(401).json({ message: 'Unauthorized' });
      const note = await createPersonalNote(viewer.id, req.body ?? {});
      res.status(201).json(note);
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/notes POST]')) return;
    }
  });

  router.put('/analytics/personal-hub/notes/:id', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string } }).user;
      if (!viewer?.id) return res.status(401).json({ message: 'Unauthorized' });
      const note = await updatePersonalNote(viewer.id, req.params.id, req.body ?? {});
      if (!note) return res.status(404).json({ message: 'Note not found' });
      res.json(note);
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/notes PUT]')) return;
    }
  });

  router.delete('/analytics/personal-hub/notes/:id', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string } }).user;
      if (!viewer?.id) return res.status(401).json({ message: 'Unauthorized' });
      const ok = await deletePersonalNote(viewer.id, req.params.id);
      if (!ok) return res.status(404).json({ message: 'Note not found' });
      res.json({ ok: true });
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/notes DELETE]')) return;
    }
  });

  router.get('/analytics/personal-hub/alerts', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string } }).user;
      if (!viewer?.id) return res.status(401).json({ message: 'Unauthorized' });
      res.json({ alerts: await listPersonalAlerts(viewer.id) });
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/alerts]')) return;
    }
  });

  router.post('/analytics/personal-hub/alerts', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string } }).user;
      if (!viewer?.id) return res.status(401).json({ message: 'Unauthorized' });
      const title = String(req.body?.title ?? '').trim();
      const alertAt = String(req.body?.alertAt ?? '').trim();
      if (!title || !alertAt) {
        return res.status(400).json({ message: 'title and alertAt are required' });
      }
      const alert = await createPersonalAlert(viewer.id, {
        title,
        alertAt,
        notes: req.body?.notes,
      });
      res.status(201).json(alert);
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/alerts POST]')) return;
    }
  });

  router.put('/analytics/personal-hub/alerts/:id', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string } }).user;
      if (!viewer?.id) return res.status(401).json({ message: 'Unauthorized' });
      const alert = await updatePersonalAlert(viewer.id, req.params.id, req.body ?? {});
      if (!alert) return res.status(404).json({ message: 'Alert not found' });
      res.json(alert);
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/alerts PUT]')) return;
    }
  });

  router.delete('/analytics/personal-hub/alerts/:id', requirePersonalView, async (req, res) => {
    try {
      const viewer = (req as { user?: { id: string } }).user;
      if (!viewer?.id) return res.status(401).json({ message: 'Unauthorized' });
      const ok = await deletePersonalAlert(viewer.id, req.params.id);
      if (!ok) return res.status(404).json({ message: 'Alert not found' });
      res.json({ ok: true });
    } catch (e) {
      if (!hubAccessError(e, res, '[analytics/personal-hub/alerts DELETE]')) return;
    }
  });

}
