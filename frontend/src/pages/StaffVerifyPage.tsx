import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, BadgeCheck, Building2, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Api } from '../services/api';
import { resolveMediaUrl } from '../utils/mediaUrl';
import './staffVerify.css';

export type StaffVerifyPayload = {
  verified: boolean;
  employeeId: string;
  nameEn: string;
  nameKh: string;
  positionTitle: string;
  departmentName: string;
  avatarUrl: string | null;
  status: string;
  isActiveStaff: boolean;
  companyName: string;
  companyLogo: string;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: StaffVerifyPayload }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

function statusLabel(status: string, isActive: boolean): string {
  if (isActive) return 'Active staff';
  const s = status.trim().toLowerCase();
  if (!s || s === 'unknown') return 'Not active';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const StaffVerifyPage: React.FC = () => {
  const { employeeId: rawId } = useParams<{ employeeId: string }>();
  const employeeId = useMemo(() => {
    try {
      return decodeURIComponent(String(rawId ?? '').trim());
    } catch {
      return String(rawId ?? '').trim();
    }
  }, [rawId]);

  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!employeeId) {
      setState({ kind: 'missing' });
      return;
    }

    setState({ kind: 'loading' });
    void (async () => {
      try {
        const data = (await Api.public.verifyStaff(employeeId)) as StaffVerifyPayload;
        if (cancelled) return;
        if (!data?.employeeId) {
          setState({ kind: 'missing' });
          return;
        }
        setState({ kind: 'ready', data });
      } catch (e) {
        if (cancelled) return;
        const err = e as Error & { status?: number };
        const msg = err instanceof Error ? err.message : 'Could not verify staff';
        if (err.status === 404 || /not found|404/i.test(msg)) setState({ kind: 'missing' });
        else setState({ kind: 'error', message: msg });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const companyName =
    state.kind === 'ready' ? state.data.companyName || 'Company' : 'Staff verification';
  const logoSrc =
    state.kind === 'ready' ? resolveMediaUrl(state.data.companyLogo) || '' : '';

  return (
    <div className="staff-verify">
      <div className="staff-verify__bg" aria-hidden />

      <header className="staff-verify__top">
        <div className="staff-verify__brand">
          {logoSrc ? (
            <img className="staff-verify__logo" src={logoSrc} alt="" />
          ) : (
            <span className="staff-verify__logo-fallback" aria-hidden>
              <Building2 className="h-5 w-5" />
            </span>
          )}
          <div className="staff-verify__brand-text">
            <p className="staff-verify__company">{companyName}</p>
            <p className="staff-verify__eyebrow">Staff ID verification</p>
          </div>
        </div>
      </header>

      <main className="staff-verify__main">
        {state.kind === 'loading' && (
          <section className="staff-verify__panel staff-verify__panel--center" aria-busy="true">
            <Loader2 className="staff-verify__spinner h-8 w-8 animate-spin" />
            <p className="staff-verify__muted">Checking staff record…</p>
          </section>
        )}

        {state.kind === 'missing' && (
          <section className="staff-verify__panel staff-verify__panel--center">
            <div className="staff-verify__status staff-verify__status--warn">
              <ShieldAlert className="h-5 w-5" />
              <span>Not found</span>
            </div>
            <h1 className="staff-verify__title">No matching staff ID</h1>
            <p className="staff-verify__lead">
              We could not find an employee with ID{' '}
              <span className="staff-verify__mono">{employeeId || '—'}</span> in this organization.
            </p>
          </section>
        )}

        {state.kind === 'error' && (
          <section className="staff-verify__panel staff-verify__panel--center">
            <div className="staff-verify__status staff-verify__status--warn">
              <AlertCircle className="h-5 w-5" />
              <span>Unavailable</span>
            </div>
            <h1 className="staff-verify__title">Verification unavailable</h1>
            <p className="staff-verify__lead">{state.message}</p>
          </section>
        )}

        {state.kind === 'ready' && (
          <section className="staff-verify__panel">
            <div
              className={`staff-verify__status ${
                state.data.isActiveStaff
                  ? 'staff-verify__status--ok'
                  : 'staff-verify__status--warn'
              }`}
            >
              {state.data.isActiveStaff ? (
                <ShieldCheck className="h-5 w-5" />
              ) : (
                <ShieldAlert className="h-5 w-5" />
              )}
              <span>
                {state.data.isActiveStaff
                  ? 'Verified active staff'
                  : 'Not currently active staff'}
              </span>
            </div>

            <div className="staff-verify__identity">
              <div className="staff-verify__avatar-wrap">
                {resolveMediaUrl(state.data.avatarUrl) ? (
                  <img
                    className="staff-verify__avatar"
                    src={resolveMediaUrl(state.data.avatarUrl)}
                    alt=""
                  />
                ) : (
                  <div className="staff-verify__avatar staff-verify__avatar--placeholder" aria-hidden>
                    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="32" cy="24" r="12" fill="currentColor" />
                      <path
                        d="M8 58c0-13.255 10.745-24 24-24s24 10.745 24 24"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                )}
                {state.data.isActiveStaff && (
                  <span className="staff-verify__check" title="Verified">
                    <BadgeCheck className="h-5 w-5" />
                  </span>
                )}
              </div>

              {state.data.nameKh ? (
                <p className="staff-verify__name-kh">{state.data.nameKh}</p>
              ) : null}
              <h1 className="staff-verify__name">{state.data.nameEn}</h1>
              <p className="staff-verify__id">{state.data.employeeId}</p>
            </div>

            <dl className="staff-verify__facts">
              <div>
                <dt>Position</dt>
                <dd>{state.data.positionTitle}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{state.data.departmentName}</dd>
              </div>
              <div>
                <dt>Employment status</dt>
                <dd>{statusLabel(state.data.status, state.data.isActiveStaff)}</dd>
              </div>
              <div>
                <dt>Organization</dt>
                <dd>{state.data.companyName}</dd>
              </div>
            </dl>

            <p className="staff-verify__footnote">
              {state.data.isActiveStaff
                ? `This person is a verified staff member of ${state.data.companyName}.`
                : `This ID was found, but the person is not listed as active staff at ${state.data.companyName}.`}
            </p>
          </section>
        )}
      </main>

      <footer className="staff-verify__footer">
        <p>Scan result from an official employee ID card</p>
        <Link to="/login" className="staff-verify__login-link">
          Staff portal sign-in
        </Link>
      </footer>
    </div>
  );
};

export default StaffVerifyPage;
