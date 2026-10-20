import type pg from "pg";
import { isValidAbn } from "@yourtal/contracts/invoice/abn";
import {
  buyerDetailsRequired,
  invoiceNumberOf,
  isTaxInvoiceFor,
} from "@yourtal/contracts/invoice/rules";
import { issuerFor } from "./settings";
import { INVOICED_REGIONS, loadSource } from "./sources";
import type { InvoiceSourceRef, IssueOutcome, Queryable, SkipReason } from "./types";

interface Existing {
  readonly id: string;
  readonly number: string;
}

async function existingFor(db: Queryable, source: InvoiceSourceRef): Promise<Existing | null> {
  const { rows } = await db.query<Existing>(
    `SELECT id::text AS id, number FROM invoice.invoice WHERE source_kind = $1 AND source_id = $2`,
    [source.kind, source.id],
  );
  return rows[0] ?? null;
}

/** The business's own record: its legal name, and its ABN only if it holds a valid one. */
async function buyerOf(
  db: Queryable,
  businessId: string,
): Promise<{ legalName: string; abn: string | null } | null> {
  const { rows } = await db.query<{
    legal_name: string;
    tax_id_kind: string;
    tax_id_value: string;
  }>(`SELECT legal_name, tax_id_kind, tax_id_value FROM business.business_accounts WHERE id = $1`, [
    businessId,
  ]);
  const row = rows[0];
  if (row === undefined) return null;
  const hasAbn = row.tax_id_kind === "ABN" && isValidAbn(row.tax_id_value);
  return { legalName: row.legal_name, abn: hasAbn ? row.tax_id_value : null };
}

/**
 * Issues the invoice for a paid source, once. Safe to call again and from two
 * places at once: the second caller gets the first's invoice back.
 *
 * The region's counter row is locked FIRST, then the source is checked for an
 * invoice again, so a racing issuer of the same source waits here, sees the
 * committed invoice and rolls its own number back: numbers stay gapless and
 * a source never gets two. Amounts are copied from the source's rows (the GST
 * on a manual purchase is the one thing worked out here, at the region rate).
 */
export async function issueInvoice(db: pg.Pool, source: InvoiceSourceRef): Promise<IssueOutcome> {
  const already = await existingFor(db, source);
  if (already !== null) return { status: "exists", invoiceId: already.id, number: already.number };

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const outcome = await issueWithin(client, source);
    await client.query(outcome.status === "issued" ? "COMMIT" : "ROLLBACK");
    if (outcome.status === "skipped")
      await rememberSkip(db, source, outcome.reason, outcome.region);
    return outcome;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** A whole-region wait is not a per-source problem, so it is not remembered per source. */
const NOT_REMEMBERED: readonly SkipReason[] = ["issuer_not_configured", "region_not_invoiced"];

/** Lets the job leave this source out of its next batches for a while (see `findUninvoiced`). */
async function rememberSkip(
  db: pg.Pool,
  source: InvoiceSourceRef,
  reason: SkipReason,
  region: "AU" | "ID" | null,
): Promise<void> {
  if (NOT_REMEMBERED.includes(reason)) return;
  await db.query(
    `INSERT INTO invoice.issue_skip (source_kind, source_id, region, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_kind, source_id)
     DO UPDATE SET reason = EXCLUDED.reason, region = EXCLUDED.region, last_tried_at = now()`,
    [source.kind, source.id, region, reason],
  );
}

async function issueWithin(client: pg.PoolClient, source: InvoiceSourceRef): Promise<IssueOutcome> {
  const loaded = await loadSource(client, source);
  if (!loaded.ok) return { status: "skipped", reason: loaded.reason, region: null };
  const facts = loaded.facts;
  if (!INVOICED_REGIONS.includes(facts.region)) {
    return { status: "skipped", reason: "region_not_invoiced", region: facts.region };
  }
  const issuer = await issuerFor(client, facts.region);
  if (issuer === null) {
    return { status: "skipped", reason: "issuer_not_configured", region: facts.region };
  }
  const buyer = await buyerOf(client, facts.businessId);
  // From A$1,000 a tax invoice must name the buyer; a record without a name waits.
  const buyerNeeded = isTaxInvoiceFor(issuer.abn) && buyerDetailsRequired(facts.totalMinor);
  if (buyer === null || (buyerNeeded && buyer.legalName.trim() === "")) {
    return { status: "skipped", reason: "buyer_not_found", region: facts.region };
  }

  // The gapless counter: this row lock is held until the invoice commits.
  const counter = await client.query<{ last_number: string }>(
    `SELECT last_number::text FROM invoice.counter WHERE region = $1 FOR UPDATE`,
    [facts.region],
  );
  if (counter.rows[0] === undefined) throw new Error(`no invoice counter for ${facts.region}`);
  const raced = await existingFor(client, source);
  if (raced !== null) return { status: "exists", invoiceId: raced.id, number: raced.number };

  if (facts.subtotalMinor + facts.taxMinor !== facts.totalMinor) {
    throw new Error(`source ${source.kind}:${source.id} does not add up to its total`);
  }
  const seq = Number(counter.rows[0].last_number) + 1;
  await client.query(`UPDATE invoice.counter SET last_number = $2 WHERE region = $1`, [
    facts.region,
    seq,
  ]);

  const isTaxInvoice = isTaxInvoiceFor(issuer.abn);
  const number = invoiceNumberOf(facts.region, seq);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO invoice.invoice
       (region, seq, number, business_id, source_kind, source_id, currency, subtotal_minor,
        tax_minor, total_minor, tax_rate_bps, issuer_legal_name, issuer_abn, issuer_address,
        issuer_email, buyer_legal_name, buyer_abn, is_tax_invoice, payment_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING id::text AS id`,
    [
      facts.region,
      seq,
      number,
      facts.businessId,
      source.kind,
      source.id,
      facts.currency,
      facts.subtotalMinor,
      facts.taxMinor,
      facts.totalMinor,
      facts.taxRateBps,
      issuer.legalName,
      // An ABN that fails its checksum is not printed as if it were one.
      isTaxInvoice ? issuer.abn : null,
      issuer.address,
      issuer.email,
      buyer.legalName,
      buyer.abn,
      isTaxInvoice,
      facts.paymentRef,
    ],
  );
  const invoiceId = inserted.rows[0]?.id;
  if (invoiceId === undefined) throw new Error("invoice insert returned no row");
  // One line today: a quantity of one, the whole ex-GST price as its unit.
  await client.query(
    `INSERT INTO invoice.line (invoice_id, position, description, quantity, unit_minor, subtotal_minor, tax_minor)
     VALUES ($1, 1, $2, 1, $3, $3, $4)`,
    [invoiceId, facts.description, facts.subtotalMinor, facts.taxMinor],
  );
  return { status: "issued", invoiceId, number };
}
