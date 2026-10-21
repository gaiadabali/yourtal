/**
 * Who may read which `/api/dev/inbox` entries (5.13.b). The whole rule lives
 * here, pure, so it is tested directly rather than only through HTTP.
 *
 * The bodies carry live links (email verification, password reset, guardian
 * consent, team invitations) for real staging accounts, so outside local dev
 * a viewer sees only mail addressed to their own sign-in email. Staff see
 * everything, because reviewing what the app sends is their job.
 */

/** `closed`: production, the route does not exist. `open`: local dev, no session needed. `gated`: everything else. */
export type InboxEnvironment = "closed" | "open" | "gated";

export function inboxEnvironment(appEnv: string): InboxEnvironment {
  if (appEnv === "production") return "closed";
  if (appEnv === "dev") return "open";
  // staging, and any value nobody has named yet: fail towards needing a session.
  return "gated";
}

/** A signed-in caller. `null` in place of a viewer means no session was presented. */
export interface InboxViewer {
  readonly staff: boolean;
  /** The account's sign-in email, or `null` if it has none. */
  readonly email: string | null;
}

/** `open`: local dev, everyone's. `staff`: everyone's, for a staff viewer. `own`: only the viewer's own. */
export type InboxAccess = "open" | "staff" | "own";

export type InboxView<E> =
  | { readonly kind: "refused"; readonly reason: "not_found" | "sign_in_required" }
  | { readonly kind: "visible"; readonly access: InboxAccess; readonly entries: readonly E[] };

export function decideInboxView<E extends { readonly recipient: string }>(
  appEnv: string,
  viewer: InboxViewer | null,
  entries: readonly E[],
): InboxView<E> {
  const environment = inboxEnvironment(appEnv);
  if (environment === "closed") return { kind: "refused", reason: "not_found" };
  if (environment === "open") return { kind: "visible", access: "open", entries };
  if (viewer === null) return { kind: "refused", reason: "sign_in_required" };
  if (viewer.staff) return { kind: "visible", access: "staff", entries };

  const own = viewer.email === null ? null : normaliseAddress(viewer.email);
  return {
    kind: "visible",
    access: "own",
    entries:
      own === null || own === ""
        ? []
        : entries.filter((entry) => normaliseAddress(entry.recipient) === own),
  };
}

/** Case-insensitive, as email addresses are in practice. */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}
