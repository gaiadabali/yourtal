import { DEMO_PEOPLE } from "@yourtal/db/demo-world/people";
import { normalizeEmail } from "./email";

/**
 * Staging test kit: the demo people anyone may sign in as without a password
 * (`demo-sign-in.controller.ts`). Never staff: a password-less staff session
 * would open the staff console and every inbox to the internet. Because these
 * accounts are shared, staging also refuses to reset their password or delete
 * them (`AuthService.requestPasswordReset`, `DELETE /api/me`, the guardian's
 * delete link); the demo-world reset restores them.
 */
export const PASSWORDLESS_DEMO_PEOPLE = DEMO_PEOPLE.filter((p) => p.staffRole === undefined);

const EMAILS: ReadonlySet<string> = new Set(PASSWORDLESS_DEMO_PEOPLE.map((p) => p.email));

export function isPasswordlessDemoEmail(email: string): boolean {
  return EMAILS.has(normalizeEmail(email));
}
