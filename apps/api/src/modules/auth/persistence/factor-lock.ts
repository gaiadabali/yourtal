import { and, eq, isNotNull } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { PASSWORD_CREDENTIAL_KIND, TOTP_CREDENTIAL_KIND } from "./credential.repository";
import { credentials } from "./schema/credential.table";
import { passkeys } from "./schema/passkey.table";

/**
 * The account's sign-in methods change under one lock: its `password`
 * credential row (one per account). Adding a factor, removing one, and the
 * reset that removes them all take it `FOR UPDATE`; a passkey or code sign-in
 * takes it `FOR SHARE` while it re-checks its factor and writes its session.
 * So "is this the account's first factor?", the factor window, and "does the
 * factor that just signed in still exist?" are each decided against a state
 * nothing else is changing at that moment.
 */
export type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export async function lockAccount(tx: Tx, userId: string, mode: "update" | "share"): Promise<void> {
  await tx
    .select({ userId: credentials.userId })
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.kind, PASSWORD_CREDENTIAL_KIND)))
    .for(mode);
}

/** Any passkey, or a switched-on authenticator app. */
export async function hasAnyFactor(tx: Tx, userId: string): Promise<boolean> {
  const [passkey] = await tx
    .select({ id: passkeys.credentialId })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .limit(1);
  if (passkey !== undefined) return true;
  const [totp] = await tx
    .select({ userId: credentials.userId })
    .from(credentials)
    .where(
      and(
        eq(credentials.userId, userId),
        eq(credentials.kind, TOTP_CREDENTIAL_KIND),
        isNotNull(credentials.verifiedAt),
      ),
    );
  return totp !== undefined;
}

/** The factor just stored is the account's first: its window opens (or restarts) now. */
export async function openFactorWindow(tx: Tx, userId: string, until: Date): Promise<void> {
  await tx
    .update(credentials)
    .set({ factorsOpenUntil: until })
    .where(and(eq(credentials.userId, userId), eq(credentials.kind, PASSWORD_CREDENTIAL_KIND)));
}

/** The factor a sign-in used: one passkey, or the account's authenticator app. */
export type UsedFactor =
  { readonly kind: "passkey"; readonly credentialId: string } | { readonly kind: "totp" };

export async function factorStillPresent(
  tx: Tx,
  userId: string,
  factor: UsedFactor,
): Promise<boolean> {
  if (factor.kind === "passkey") {
    const [row] = await tx
      .select({ id: passkeys.credentialId })
      .from(passkeys)
      .where(and(eq(passkeys.userId, userId), eq(passkeys.credentialId, factor.credentialId)));
    return row !== undefined;
  }
  const [row] = await tx
    .select({ userId: credentials.userId })
    .from(credentials)
    .where(
      and(
        eq(credentials.userId, userId),
        eq(credentials.kind, TOTP_CREDENTIAL_KIND),
        isNotNull(credentials.verifiedAt),
      ),
    );
  return row !== undefined;
}
