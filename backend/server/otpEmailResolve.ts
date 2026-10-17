import { Employee } from './db.js';
import { isPlaceholderDraftEmail } from './employeeDraft.js';
import { findUserByPhone } from './userAuth.js';

const isValidOtpEmail = (raw: unknown): string | null => {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!email || !email.includes('@') || isPlaceholderDraftEmail(email)) return null;
  return email;
};

/** Email used for OTP — user account email, else linked employee email. */
export async function resolveOtpEmailForUser(user: any, phone?: string): Promise<string | null> {
  const fromUser = isValidOtpEmail(user?.email);
  if (fromUser) return fromUser;

  const employeeId = String(user?.employeeId ?? '').trim();
  if (employeeId) {
    const emp = await Employee.findByPk(employeeId);
    const plain = emp?.toJSON ? emp.toJSON() : emp;
    const fromEmp = isValidOtpEmail((plain as { email?: string })?.email);
    if (fromEmp) return fromEmp;
  }

  return null;
}
