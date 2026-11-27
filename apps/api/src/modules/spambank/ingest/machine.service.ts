import { Inject, Injectable } from "@nestjs/common";
import type { StatementOutcome } from "@yourtal/contracts/spambank/events";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import { STATEMENT_MAX_BYTES } from "../classify/statement-attachments";
import { SPAMBANK_DRIVER } from "../spambank.tokens";
import { SpambankDb } from "../spambank-db";
import { cleanText } from "./db";
import { JmapProblem, downloadPath, readSession } from "./jmap-session";
import type { JmapSession } from "./jmap-session";

/**
 * What SnapApp's server may do with a mailed statement (BUILD.md §4.8 steps 4-5, §5.2): fetch the bytes of an
 * offered attachment, and report what it did. The person is named by SnapApp's own pairwise `sub`, resolved
 * in its sector, and every call re-checks that the consent to that app is live and the mailbox is active.
 */
export type Resolved =
  | {
      readonly ok: true;
      readonly mailboxId: string;
      readonly localPart: string;
      readonly domain: string;
    }
  | { readonly ok: false; readonly code: "unknown_subject" | "not_allowed" | "not_enabled" };

export type ResolvedPerson = Extract<Resolved, { ok: true }>;

export type FetchResult =
  | {
      readonly ok: true;
      readonly body: ReadableStream<Uint8Array>;
      readonly name: string;
      readonly type: string;
    }
  | { readonly ok: false; readonly code: "not_found" | "unavailable" | "upstream" };

const SAFE_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;

@Injectable()
export class SpambankMachineService {
  constructor(
    @Inject(SpambankDb) private readonly db: SpambankDb,
    @Inject(SPAMBANK_DRIVER) private readonly driver: SpambankDriver,
  ) {}

  async resolve(sector: string, sub: string): Promise<Resolved> {
    const { rows } = await this.db.pool.query<{
      consent_live: boolean | null;
      mailbox_id: string | null;
      local_part: string | null;
      domain: string | null;
      status: string | null;
    }>(
      `SELECT c.user_id IS NOT NULL AND c.ended_at IS NULL AS consent_live,
              m.id AS mailbox_id, m.local_part, m.domain, m.status
         FROM oidc.subject s
         LEFT JOIN oidc.app_consent c ON c.user_id = s.user_id AND c.sector = s.sector
         LEFT JOIN spambank.mailbox m ON m.user_id = s.user_id
        WHERE s.sector = $1 AND s.sub = $2`,
      [sector, sub],
    );
    const row = rows[0];
    if (row === undefined) return { ok: false, code: "unknown_subject" };
    if (row.consent_live !== true) return { ok: false, code: "not_allowed" };
    if (row.mailbox_id === null || row.local_part === null || row.domain === null) {
      return { ok: false, code: "not_enabled" };
    }
    if (row.status === "provisioning") return { ok: false, code: "not_enabled" };
    if (row.status !== "active") return { ok: false, code: "not_allowed" };
    return { ok: true, mailboxId: row.mailbox_id, localPart: row.local_part, domain: row.domain };
  }

  /** Only a (message, blob) pair that was offered can be fetched: the offer rows are the access list. */
  async fetchOffered(
    person: ResolvedPerson,
    emailId: string,
    blobId: string,
  ): Promise<FetchResult> {
    const { rows } = await this.db.pool.query<{ name: string | null; type: string; size: number }>(
      `SELECT name, type, size FROM spambank.statement_offer
        WHERE mailbox_id = $1 AND email_id = $2 AND blob_id = $3`,
      [person.mailboxId, emailId, blobId],
    );
    const offer = rows[0];
    if (offer === undefined) return { ok: false, code: "not_found" };
    const type = SAFE_TYPE.test(offer.type) ? offer.type : "application/octet-stream";
    const name = cleanText(offer.name, 255) ?? "statement";

    const client = this.driver.account(person.localPart, person.domain);
    let session: JmapSession;
    try {
      session = await readSession(client);
    } catch (error) {
      const down = error instanceof JmapProblem && error.code === "unavailable";
      return { ok: false, code: down ? "unavailable" : "upstream" };
    }
    const response = await client.fetch(downloadPath(session, blobId, name, type), {
      timeoutMs: 60_000,
    });
    if (response.isErr()) {
      return {
        ok: false,
        code: response.error.code === "unavailable" ? "unavailable" : "upstream",
      };
    }
    const upstream = response.value;
    const length = Number(upstream.headers.get("content-length") ?? "0");
    if (upstream.status === 404 || upstream.status === 410) {
      await upstream.body?.cancel();
      return { ok: false, code: "not_found" };
    }
    if (!upstream.ok || upstream.body === null || length > STATEMENT_MAX_BYTES) {
      await upstream.body?.cancel();
      return { ok: false, code: "upstream" };
    }
    return { ok: true, body: upstream.body, name, type };
  }

  /** False when there is no such offer for this person. */
  async acknowledge(
    person: ResolvedPerson,
    emailId: string,
    blobId: string,
    outcome: StatementOutcome,
    detail: string | undefined,
  ): Promise<boolean> {
    const result = await this.db.pool.query(
      `UPDATE spambank.statement_offer
          SET outcome = $4, outcome_at = now(), detail = $5
        WHERE mailbox_id = $1 AND email_id = $2 AND blob_id = $3`,
      [person.mailboxId, emailId, blobId, outcome, cleanText(detail, 500)],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
