import type { MailApiErrorCode } from "@yourtal/contracts/spambank/mail";
import type { SpambankApp } from "@yourtal/contracts/spambank/common";
import { addressFor } from "../credentials";
import { verifyMailToken } from "../mail-token";
import type { MailboxRecord, SpambankMailStore } from "./mail-store";

/**
 * Who a mail-API request is for (spambank/BUILD.md §4.3): the bearer mail token, verified in constant
 * time, then the mailbox row, which must be `active` and belong to the token's person. The row is
 * cached for at most 30 seconds, so a suspended or erased mailbox stops answering within that.
 */

export interface MailPrincipal {
  readonly mailboxId: string;
  readonly userId: string;
  readonly app: SpambankApp;
  readonly localPart: string;
  readonly domain: string;
  readonly address: string;
  readonly junkMailboxId: string | null;
}

export type MailAuthResult =
  | { readonly ok: true; readonly principal: MailPrincipal }
  | {
      readonly ok: false;
      readonly status: 401 | 403 | 409 | 503;
      readonly code: MailApiErrorCode;
      readonly message: string;
    };

const CACHE_MS = 30_000;
const CACHE_MAX = 5_000;

export interface MailAuthenticator {
  authenticate(authorization: string | undefined): Promise<MailAuthResult>;
  /** Drops the cached row, for tests and after a status change in this process. */
  forget(mailboxId: string): void;
}

export function createMailAuthenticator(options: {
  readonly tokenKey: string | undefined;
  readonly store: SpambankMailStore;
  readonly now?: () => number;
}): MailAuthenticator {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { row: MailboxRecord | undefined; until: number }>();

  async function mailbox(id: string): Promise<MailboxRecord | undefined> {
    const hit = cache.get(id);
    if (hit !== undefined && hit.until > now()) return hit.row;
    const row = await options.store.findMailbox(id);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(id, { row, until: now() + CACHE_MS });
    return row;
  }

  return {
    forget: (id) => {
      cache.delete(id);
    },

    async authenticate(authorization) {
      const key = options.tokenKey;
      if (key === undefined) {
        return {
          ok: false,
          status: 503,
          code: "spambank_unavailable",
          message: "Mail is not set up on this server.",
        };
      }
      const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
      const token = match?.[1];
      if (token === undefined) {
        return {
          ok: false,
          status: 401,
          code: "unauthorized",
          message: "A mail token is required.",
        };
      }
      const verified = verifyMailToken(token, key, now());
      if (!verified.ok) {
        return {
          ok: false,
          status: 401,
          code: "unauthorized",
          message: "The mail token is not valid.",
        };
      }
      const { payload } = verified;
      const row = await mailbox(payload.m);
      if (row?.userId !== payload.u || row.status === "erasing" || row.status === "provisioning") {
        return {
          ok: false,
          status: 409,
          code: "not_enabled",
          message: "This mailbox is not switched on.",
        };
      }
      if (row.status !== "active") {
        return {
          ok: false,
          status: 403,
          code: "not_allowed",
          message: "This mailbox is suspended.",
        };
      }
      return {
        ok: true,
        principal: {
          mailboxId: row.id,
          userId: row.userId,
          app: payload.a,
          localPart: row.localPart,
          domain: row.domain,
          address: addressFor(row.localPart, row.domain),
          junkMailboxId: row.junkMailboxId,
        },
      };
    },
  };
}
