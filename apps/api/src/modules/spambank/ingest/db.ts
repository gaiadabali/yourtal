import type { QueryResult, QueryResultRow } from "pg";

/** What the ingest SQL needs: a pool or one checked-out client (so a transaction can span calls). */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

/** One `spambank.mailbox` row, the columns ingest reads. */
export interface MailboxRow {
  readonly id: string;
  readonly user_id: string;
  readonly region: "AU" | "ID";
  readonly local_part: string;
  readonly domain: string;
  readonly stalwart_account_id: string | null;
  readonly junk_mailbox_id: string | null;
  readonly status: "provisioning" | "active" | "suspended" | "erasing";
  readonly statements_to_snapapp: boolean;
  readonly new_mail_alerts: boolean;
  readonly email_state: string | null;
}

export const MAILBOX_COLUMNS =
  "id, user_id, region, local_part, domain, stalwart_account_id, junk_mailbox_id, status, " +
  "statements_to_snapapp, new_mail_alerts, email_state";

/** Free text from a mail header, made safe to store: no control characters, one line, clipped. */
export function cleanText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const one = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ");
  const trimmed = one.trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
