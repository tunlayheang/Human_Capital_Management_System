import { randomBytes, randomUUID } from 'node:crypto';

export type RestoreJobStatus = 'queued' | 'running' | 'success' | 'failed';

export type RestoreJobResult = {
  statementsExecuted: number;
  safetyBackupFileName?: string;
};

export type RestoreJob = {
  id: string;
  /** Secret so the UI can poll status after the DB wipe invalidates the JWT session. */
  pollToken: string;
  status: RestoreJobStatus;
  source: 'upload' | 'existing';
  fileName: string;
  performedBy: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: RestoreJobResult;
};

const jobs = new Map<string, RestoreJob>();
const JOB_TTL_MS = 2 * 60 * 60 * 1000;

function pruneOldJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    const t = Date.parse(job.finishedAt || job.startedAt);
    if (Number.isFinite(t) && t < cutoff) jobs.delete(id);
  }
}

export function createRestoreJob(input: {
  source: 'upload' | 'existing';
  fileName: string;
  performedBy: string;
}): RestoreJob {
  pruneOldJobs();
  const job: RestoreJob = {
    id: randomUUID(),
    pollToken: randomBytes(24).toString('hex'),
    status: 'queued',
    source: input.source,
    fileName: input.fileName,
    performedBy: input.performedBy,
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getRestoreJob(jobId: string): RestoreJob | undefined {
  pruneOldJobs();
  return jobs.get(jobId);
}

export function isValidRestorePollToken(jobId: string, token: string): boolean {
  const job = getRestoreJob(jobId);
  if (!job || !token) return false;
  return job.pollToken === token;
}

export async function runRestoreJob(
  jobId: string,
  work: () => Promise<RestoreJobResult>
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'running';
  try {
    const result = await work();
    job.result = result;
    job.status = 'success';
    job.finishedAt = new Date().toISOString();
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Restore failed';
    job.finishedAt = new Date().toISOString();
    console.error(`[restore-job ${jobId}] failed:`, error);
  }
}
