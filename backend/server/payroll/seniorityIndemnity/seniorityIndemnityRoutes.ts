import { Router } from 'express';
import { previewSeniorityIndemnity } from './seniorityIndemnityPayroll.js';
import {
  deleteSeniorityIndemnityPolicy,
  getSeniorityIndemnityPolicy,
  listSeniorityIndemnityPolicies,
  upsertSeniorityIndemnityPolicy,
} from './seniorityIndemnityPolicyService.js';

export function createSeniorityIndemnityRoutes(hrAccess: any): Router {
  const router = Router();

  router.get('/policies', hrAccess, async (_req, res) => {
    try {
      res.json(await listSeniorityIndemnityPolicies());
    } catch (e) {
      console.error('listSeniorityIndemnityPolicies:', e);
      res.status(500).json({ message: (e as Error)?.message || 'Internal server error' });
    }
  });

  router.get('/policies/:id', hrAccess, async (req, res) => {
    try {
      const row = await getSeniorityIndemnityPolicy(req.params.id);
      if (!row) return res.status(404).json({ message: 'Policy not found' });
      res.json(row);
    } catch (e) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/policies', hrAccess, async (req, res) => {
    try {
      res.status(201).json(await upsertSeniorityIndemnityPolicy(req.body));
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.put('/policies/:id', hrAccess, async (req, res) => {
    try {
      res.json(await upsertSeniorityIndemnityPolicy({ ...req.body, id: req.params.id }));
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.delete('/policies/:id', hrAccess, async (req, res) => {
    try {
      await deleteSeniorityIndemnityPolicy(req.params.id);
      res.status(204).send();
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.post('/preview', hrAccess, async (req, res) => {
    try {
      res.json(await previewSeniorityIndemnity(req.body ?? {}));
    } catch (e) {
      res.status(400).json({ message: (e as Error).message || 'Invalid request' });
    }
  });

  return router;
}
