import { Notification, Role } from '../types';

function isHrRole(roles?: string[]): boolean {
  if (!roles?.length) return false;
  return roles.some((r) => {
    const u = String(r).toUpperCase();
    return u === Role.ADMIN || u === Role.HR;
  });
}

function encodeQ(value: string): string {
  return encodeURIComponent(value);
}

function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const [base, existing = ''] = path.split('?');
  const search = new URLSearchParams(existing);
  for (const [key, value] of Object.entries(params)) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) search.set(key, trimmed);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

function entityIdOf(n: Notification): string {
  return String(n.entityId ?? '').trim();
}

function entityTypeOf(n: Notification): string {
  return String(n.entityType ?? '').toUpperCase();
}

/** Append entity deep-link params to a weak list URL when entityId is known. */
function enrichLink(raw: string, n: Notification): string {
  const entityId = entityIdOf(n);
  const entityType = entityTypeOf(n);
  const pathOnly = raw.split('?')[0];
  const title = n.title.toLowerCase();
  const message = n.message.toLowerCase();

  if (!entityId) {
    // Upgrade bare OT manage links even without entity id.
    if (pathOnly === '/overtime' && (title.includes('pending') || message.includes('approve'))) {
      return '/overtime?scope=manage&tab=requests';
    }
    if (pathOnly === '/leaves' && !raw.includes('scope=')) {
      if (title.includes('pending') || message.includes('review') || message.includes('finalize')) {
        return '/leaves?scope=manage&tab=requests';
      }
      return '/leaves?scope=my';
    }
    if (pathOnly === '/permissions' && !raw.includes('tab=')) {
      return '/permissions?tab=overrides';
    }
    if (pathOnly === '/payroll' && title.includes('ready for review')) {
      return '/payroll/runs';
    }
    if (raw === '/approvals/probation' || raw.startsWith('/approvals/probation?')) {
      return '/performance?tab=probation&view=approval';
    }
    if (raw === '/performance?tab=kpi-approvals' || raw.startsWith('/performance?tab=kpi-approvals')) {
      return '/performance?tab=kpi-appraisals&view=approval';
    }
    if (pathOnly === '/my-performance' && !raw.includes('tab=')) {
      return '/my-performance?tab=action';
    }
    return raw;
  }

  if (
    pathOnly === '/leaves' ||
    raw.includes('/leaves?') ||
    entityType === 'LEAVE' ||
    entityType.includes('LEAVE')
  ) {
    if (raw.includes('scope=manage') || title.includes('pending') || message.includes('finalize')) {
      return withQuery('/leaves', {
        scope: 'manage',
        tab: 'requests',
        leaveId: entityId,
      });
    }
    return withQuery('/leaves', { scope: 'my', leaveId: entityId });
  }

  if (
    pathOnly === '/overtime' ||
    raw.includes('/overtime?') ||
    entityType === 'OVERTIME' ||
    entityType.includes('OVERTIME')
  ) {
    if (raw.includes('scope=manage') || title.includes('pending') || message.includes('approve')) {
      return withQuery('/overtime', {
        scope: 'manage',
        tab: 'requests',
        requestId: entityId,
      });
    }
    return withQuery('/overtime', { scope: 'self', requestId: entityId });
  }

  if (
    pathOnly === '/performance' ||
    raw.includes('/performance?') ||
    entityType.includes('APPRAISAL') ||
    entityType.includes('PROBATION') ||
    entityType.includes('REVIEW')
  ) {
    if (
      title.includes('probation') ||
      message.includes('probation') ||
      entityType.includes('PROBATION') ||
      raw.includes('tab=probation')
    ) {
      const approval =
        raw.includes('view=approval') ||
        raw.includes('kpi-approvals') ||
        raw.includes('/approvals/probation') ||
        title.includes('approval') ||
        title.includes('approve');
      if (approval) {
        return withQuery('/performance', {
          tab: 'probation',
          view: 'approval',
          userId: entityType.includes('PROBATION') ? entityId : entityId,
          reviewId: entityId,
        });
      }
      return withQuery('/performance', { tab: 'probation', userId: entityId });
    }
    if (
      title.includes('appraisal') ||
      message.includes('appraisal') ||
      entityType.includes('APPRAISAL') ||
      raw.includes('kpi-')
    ) {
      const approval =
        raw.includes('view=approval') ||
        raw.includes('kpi-approvals') ||
        title.includes('approval') ||
        title.includes('approve') ||
        message.includes('final approval');
      return withQuery('/performance', {
        tab: 'kpi-appraisals',
        view: approval ? 'approval' : undefined,
        appraisalId: entityId,
      });
    }
  }

  if (pathOnly === '/my-performance' || raw.includes('/my-performance')) {
    return withQuery('/my-performance', { tab: 'action', appraisalId: entityId });
  }

  if (
    pathOnly === '/payroll/final-settlement' ||
    entityType.includes('SETTLEMENT') ||
    n.id.startsWith('fs-')
  ) {
    return withQuery('/payroll/final-settlement', { settlement: entityId });
  }

  if (pathOnly === '/approvals/movements' || entityType.includes('MOVEMENT')) {
    const title = String(n.title ?? '').toLowerCase();
    const id = String(n.id ?? '');
    if (title.includes('returned') || id.includes('movement-finished-returned')) {
      return withQuery('/employees/movements/view', {
        movementId: entityId,
        step: '1',
      });
    }
    return withQuery('/approvals/movements', { movementId: entityId });
  }

  if (pathOnly === '/permissions' || entityType.includes('PERM')) {
    return withQuery('/permissions', { tab: 'overrides' });
  }

  if (pathOnly === '/projects' || entityType === 'TASK' || entityType === 'PROJECT') {
    if (entityType === 'TASK') {
      return withQuery('/projects', { task: entityId });
    }
    return withQuery('/projects', { project: entityId });
  }

  if (pathOnly === '/payroll/approvals' || pathOnly.startsWith('/payroll/approvals/')) {
    if (!pathOnly.includes(entityId) && entityType.includes('PAYROLL')) {
      return `/payroll/approvals/${encodeQ(entityId)}`;
    }
  }

  return raw;
}

function linkFromEntity(n: Notification, options?: { roles?: string[] }): string | undefined {
  const entityId = entityIdOf(n);
  const entityType = entityTypeOf(n);
  const title = n.title.toLowerCase();
  const message = n.message.toLowerCase();
  if (!entityId && !entityType) return undefined;

  if (entityType === 'LEAVE' || entityType.includes('LEAVE') || n.id.includes('leave-')) {
    const id = entityId || n.id.replace(/^leave-(pending-(mgr|hr)-|status-|mgr-ok-)/, '').split('-')[0];
    const leaveId = entityId || (id.length > 8 ? id : '');
    if (title.includes('pending') || message.includes('finalize') || message.includes('approve as manager')) {
      return withQuery('/leaves', { scope: 'manage', tab: 'requests', leaveId: leaveId || undefined });
    }
    return withQuery('/leaves', { scope: 'my', leaveId: leaveId || undefined });
  }

  if (entityType === 'OVERTIME' || entityType.includes('OVERTIME') || n.id.startsWith('ot-')) {
    if (title.includes('pending') || message.includes('approve')) {
      return withQuery('/overtime', {
        scope: 'manage',
        tab: 'requests',
        requestId: entityId || undefined,
      });
    }
    return withQuery('/overtime', { scope: 'self', requestId: entityId || undefined });
  }

  if (entityType.includes('APPRAISAL') || n.id.includes('appraisal')) {
    const approval =
      title.includes('approval') ||
      title.includes('approve') ||
      message.includes('final approval') ||
      n.id.includes('approval');
    return withQuery('/performance', {
      tab: 'kpi-appraisals',
      view: approval ? 'approval' : undefined,
      appraisalId: entityId || undefined,
    });
  }

  if (entityType.includes('PROBATION') || n.id.includes('probation') || n.id.startsWith('pev-')) {
    const approval =
      title.includes('approval') || title.includes('approve') || n.id.includes('approve');
    if (approval) {
      return withQuery('/performance', {
        tab: 'probation',
        view: 'approval',
        userId: entityId || undefined,
        reviewId: entityId || undefined,
      });
    }
    if (title.includes('self-evaluation') || n.id.includes('self-eval')) {
      return '/my-performance?tab=action';
    }
    return withQuery('/performance', { tab: 'probation', userId: entityId || undefined });
  }

  if (entityType.includes('SETTLEMENT') || n.id.startsWith('fs-')) {
    return withQuery('/payroll/final-settlement', { settlement: entityId || undefined });
  }

  if (entityType.includes('MOVEMENT') || n.id.includes('movement')) {
    if (title.includes('returned') || n.id.includes('movement-finished-returned')) {
      return withQuery('/employees/movements/view', {
        movementId: entityId || undefined,
        step: '1',
      });
    }
    return withQuery('/approvals/movements', { movementId: entityId || undefined });
  }

  if (entityType === 'TASK') {
    return withQuery('/projects', { task: entityId });
  }
  if (entityType === 'PROJECT') {
    return withQuery('/projects', { project: entityId });
  }

  if (entityType === 'ROLE' || title.includes('role permissions')) {
    return isHrRole(options?.roles) ? '/permissions?tab=matrix' : '/account-settings?tab=security';
  }

  if (entityType === 'USER_ACCOUNT' || entityType === 'AUTHENTICATION') {
    if (title.includes('device') || title.includes('login')) {
      return '/account-settings?tab=activity';
    }
    return '/account-settings?tab=security';
  }

  if (entityType.includes('PAYROLL') || n.id.includes('payroll-')) {
    if (
      /^PRROC\d+$/i.test(entityId) ||
      entityId.startsWith('run-') ||
      /(?:^|[^a-z])run(?:$|[^a-z])/i.test(entityId)
    ) {
      return `/payroll/approvals/${encodeQ(entityId)}`;
    }
  }

  return undefined;
}

function linkFromPayrollRunNotification(n: Notification): string | undefined {
  const id = n.id;
  if (id.startsWith('payroll-approval-turn-') || id.startsWith('payroll-approval-assigned-')) {
    const prefix = id.startsWith('payroll-approval-turn-')
      ? 'payroll-approval-turn-'
      : 'payroll-approval-assigned-';
    const rest = id.slice(prefix.length);
    const match = rest.match(/^(PRROC\d+|run-[a-zA-Z0-9-]+)-/i);
    if (match?.[1]) return `/payroll/approvals/${match[1]}`;
    return '/payroll/approvals';
  }
  if (id.startsWith('payroll-run-pending-')) {
    const rest = id.slice('payroll-run-pending-'.length);
    const userSuffix = rest.match(/-(u-[a-zA-Z0-9-]+)$/);
    if (userSuffix?.[1]) {
      const runId = rest.slice(0, -userSuffix[0].length);
      if (runId) return `/payroll/approvals/${runId}`;
    }
    return '/payroll/runs';
  }
  if (n.title.toLowerCase().includes('payroll run')) return '/payroll/runs';
  return undefined;
}

function isChatInviteNotification(n: Notification): boolean {
  return (
    /group chat invitation/i.test(n.title) ||
    n.id.startsWith('chat-invite-') ||
    /open inbox/i.test(n.message)
  );
}

function linkFromChatInviteId(id: string): string | undefined {
  if (!id.startsWith('chat-invite-')) return undefined;
  const match = id.match(/^chat-invite-(grp-\d+)-/);
  if (match?.[1]) return `/chat?group=${encodeURIComponent(match[1])}`;
  return '/chat';
}

function linkFromChatMessageId(id: string): string | undefined {
  if (id.startsWith('chat-dm-')) return '/chat';
  if (id.startsWith('chat-grp-')) return '/chat';
  return undefined;
}

function linkFromFinalSettlementId(id: string, n: Notification): string | undefined {
  if (!id.startsWith('fs-')) return undefined;
  const entityId = entityIdOf(n);
  if (n.link) return enrichLink(n.link, n);
  if (entityId) return withQuery('/payroll/final-settlement', { settlement: entityId });
  const fromId = id.match(/^fs-[a-z-]+-(.+?)(?:-u-|$)/);
  if (fromId?.[1]) {
    return withQuery('/payroll/final-settlement', { settlement: fromId[1] });
  }
  return '/payroll/final-settlement';
}

function linkFromPersonalHubReminderId(id: string): string | undefined {
  if (id.startsWith('personal-hub-alert-')) return '/personal-analytics';
  return undefined;
}

/** Parse required-action sync ids: `ra-pending-{actionId}-{viewerUserId}`. */
function linkFromRequiredActionId(n: Notification): string | undefined {
  if (!n.id.startsWith('ra-pending-')) return undefined;
  if (n.link) return enrichLink(n.link, { ...n, entityId: n.entityId || undefined });

  const body = n.id.slice('ra-pending-'.length);
  if (body.startsWith('appraisal-mgr-')) {
    const appraisalId = body.replace(/^appraisal-mgr-/, '').replace(/-u-[a-zA-Z0-9-]+$/, '');
    return withQuery('/performance', { tab: 'kpi-appraisals', appraisalId });
  }
  if (body.startsWith('appraisal-approve-')) {
    const appraisalId = body.replace(/^appraisal-approve-/, '').replace(/-u-[a-zA-Z0-9-]+$/, '');
    return withQuery('/performance', {
      tab: 'kpi-appraisals',
      view: 'approval',
      appraisalId,
    });
  }
  if (body.startsWith('appraisal-self-')) {
    const appraisalId = body.replace(/^appraisal-self-/, '').replace(/-u-[a-zA-Z0-9-]+$/, '');
    return withQuery('/my-performance', { tab: 'action', appraisalId });
  }
  if (body.startsWith('probation-mgr-')) {
    const userId = body.replace(/^probation-mgr-/, '').replace(/-u-[a-zA-Z0-9-]+$/, '');
    return withQuery('/performance', { tab: 'probation', userId });
  }
  if (body.startsWith('probation-approve-')) {
    const reviewId = body.replace(/^probation-approve-/, '').replace(/-u-[a-zA-Z0-9-]+$/, '');
    return withQuery('/performance', {
      tab: 'probation',
      view: 'approval',
      reviewId,
    });
  }
  if (body.startsWith('probation-self-')) {
    return '/my-performance?tab=action';
  }
  if (body.startsWith('leave-returned-')) {
    const leaveId = body
      .replace(/^leave-returned-/, '')
      .replace(/-u-[a-zA-Z0-9-]+$/, '')
      .replace(/-\d+$/, '');
    // id format: leave-returned-{leaveId}-{ownerId}-{timestamp}
    const parts = body.replace(/^leave-returned-/, '').split('-');
    // Prefer entity-style: leaveId is usually `leave-xxx` or a uuid-like token; fall back to query param from link.
    return withQuery('/leaves', { scope: 'self', leaveId: leaveId || parts[0] || undefined });
  }
  if (body.startsWith('leave-')) {
    const leaveId = body.replace(/^leave-/, '').replace(/-u-[a-zA-Z0-9-]+$/, '');
    return withQuery('/leaves', { scope: 'manage', tab: 'requests', leaveId });
  }
  if (body.startsWith('ot-returned-') || body.startsWith('overtime-returned-')) {
    const requestId = body
      .replace(/^ot-returned-/, '')
      .replace(/^overtime-returned-/, '')
      .replace(/-u-[a-zA-Z0-9-]+$/, '')
      .replace(/-\d+$/, '');
    return withQuery('/overtime', { scope: 'self', requestId });
  }
  if (body.startsWith('overtime-')) {
    const requestId = body.replace(/^overtime-/, '').replace(/-u-[a-zA-Z0-9-]+$/, '');
    return withQuery('/overtime', { scope: 'manage', tab: 'requests', requestId });
  }
  if (body.startsWith('payroll-run-')) {
    const runId = body.replace(/^payroll-run-/, '').replace(/-u-[a-zA-Z0-9-]+$/, '');
    return `/payroll/approvals/${encodeQ(runId)}`;
  }
  if (body.startsWith('movement-finished-returned-')) {
    const movementId = body
      .replace(/^movement-finished-returned-/, '')
      .replace(/-u-[a-zA-Z0-9-]+$/, '');
    return withQuery('/employees/movements/view', { movementId, step: '1' });
  }
  if (body.startsWith('movement-')) {
    const movementId = body.replace(/^movement-/, '').replace(/-u-[a-zA-Z0-9-]+$/, '');
    return withQuery('/approvals/movements', { movementId });
  }
  return undefined;
}

function inferLinkFromContent(n: Notification, options?: { roles?: string[] }): string | undefined {
  const title = n.title.toLowerCase();
  const message = n.message.toLowerCase();

  if (title.includes('personal reminder') || n.id.startsWith('personal-hub-alert-')) {
    return '/personal-analytics';
  }

  if (title.includes('role permissions') || (title.includes('permission') && title.includes('role'))) {
    return isHrRole(options?.roles) ? '/permissions?tab=matrix' : '/account-settings?tab=security';
  }

  if (
    title.includes('password') ||
    title.includes('pin ') ||
    title.includes('account ') ||
    title.includes('new device') ||
    title.includes('device login')
  ) {
    if (title.includes('device') || title.includes('login')) {
      return '/account-settings?tab=activity';
    }
    return '/account-settings?tab=security';
  }

  if (title.includes('permission') || message.includes('permission')) {
    return '/permissions?tab=overrides';
  }

  if (title.includes('leave') || message.includes('leave request')) {
    if (title.includes('pending') || message.includes('review') || message.includes('finalize')) {
      return '/leaves?scope=manage&tab=requests';
    }
    return '/leaves?scope=my';
  }
  if (title.includes('overtime') || message.includes('overtime')) {
    if (title.includes('pending') || message.includes('review') || message.includes('approve')) {
      return '/overtime?scope=manage&tab=requests';
    }
    return '/overtime?scope=self';
  }
  if (title.includes('payroll') || message.includes('payroll')) {
    if (title.includes('awaiting your approval') || message.includes('ready for your review')) {
      return '/payroll/approvals';
    }
    return '/payroll';
  }
  if (
    title.includes('final settlement') ||
    message.includes('final settlement') ||
    message.includes('settlement for')
  ) {
    return '/payroll/final-settlement';
  }
  if (title.includes('attendance period frozen') || message.includes('attendance for')) {
    return '/payroll';
  }
  if (title.includes('job change submitted') || message.includes('pending approval')) {
    return '/profile';
  }
  if (
    title.includes('self-evaluation') ||
    n.id.startsWith('appraisal-self-eval-') ||
    n.id.startsWith('probation-self-eval-')
  ) {
    return '/my-performance?tab=action';
  }
  if (title.includes('job change applied') || message.includes('now effective')) {
    return '/profile';
  }
  if (title.includes('portal account is ready')) {
    return '/dashboard';
  }
  if (title.includes('employee offboarded')) {
    return '/employees?status=inactive';
  }
  if (title.includes('deduction authorization')) {
    return '/payroll/final-settlement';
  }
  if (title.includes('sensitive change')) {
    return '/employees?tab=list';
  }
  if (title.includes('task') || message.includes('task')) {
    return '/projects';
  }
  if (title.includes('planning') || message.includes('roster')) {
    return '/leaves?scope=manage&tab=planning';
  }

  // Appraisal before the broad "approval → movements" fallback.
  if (
    title.includes('appraisal') &&
    (title.includes('approval') ||
      title.includes('approver') ||
      title.includes('complete') ||
      title.includes('returned') ||
      title.includes('rejected') ||
      title.includes('evaluate') ||
      message.includes('final approval') ||
      message.includes('assigned to evaluate'))
  ) {
    if (title.includes('evaluate') || message.includes('evaluate')) {
      return '/performance?tab=kpi-appraisals';
    }
    return '/performance?tab=kpi-appraisals&view=approval';
  }

  if (
    title.includes('probation') &&
    (title.includes('approval') ||
      title.includes('approver') ||
      title.includes('assigned') ||
      title.includes('evaluate') ||
      message.includes('awaiting your approval') ||
      message.includes('approval chain') ||
      message.includes('evaluate'))
  ) {
    if (title.includes('approval') || title.includes('approve')) {
      return '/performance?tab=probation&view=approval';
    }
    return '/performance?tab=probation';
  }

  if (
    title.includes('movement') ||
    ((title.includes('approval') ||
      title.includes('approver') ||
      title.includes('complete') ||
      title.includes('returned') ||
      title.includes('rejected') ||
      message.includes('awaiting your approval') ||
      message.includes('fully approved')) &&
      !title.includes('appraisal') &&
      !title.includes('probation') &&
      !title.includes('payroll') &&
      !title.includes('leave') &&
      !title.includes('overtime'))
  ) {
    return '/approvals/movements';
  }

  return undefined;
}

/** Route to open when the user clicks a notification (sidebar bell). */
export function resolveNotificationLink(
  n: Notification,
  options?: { roles?: string[] }
): string | undefined {
  const title = n.title.toLowerCase();
  const message = n.message.toLowerCase();
  const raw = n.link?.trim();

  if (isChatInviteNotification(n)) {
    return linkFromChatInviteId(n.id) || '/chat';
  }

  const chatMessageLink = linkFromChatMessageId(n.id);
  if (chatMessageLink) return n.link || chatMessageLink;

  const settlementLink = linkFromFinalSettlementId(n.id, n);
  if (settlementLink) return settlementLink;

  if (title.includes('message from') || n.id.startsWith('chat-dm-') || n.id.startsWith('chat-grp-')) {
    return n.link || '/chat';
  }

  if (title.includes('payslip') || message.includes('your payslip')) {
    return isHrRole(options?.roles) ? '/payroll' : '/my-pay';
  }

  const payrollRun = linkFromPayrollRunNotification(n);
  if (payrollRun) return payrollRun;

  const personalReminder = linkFromPersonalHubReminderId(n.id);
  if (personalReminder) return personalReminder;

  const requiredAction = linkFromRequiredActionId(n);
  if (requiredAction) return requiredAction;

  const fromEntity = linkFromEntity(n, options);
  if (fromEntity) return fromEntity;

  if (raw && raw !== '/dashboard') {
    return enrichLink(raw, n);
  }

  if (raw === '/dashboard') {
    return inferLinkFromContent(n, options) || raw;
  }

  return inferLinkFromContent(n, options) || raw || undefined;
}

export function notificationHasNavigation(
  n: Notification,
  options?: { roles?: string[] }
): boolean {
  return Boolean(resolveNotificationLink(n, options));
}
