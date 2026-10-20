import type pg from "pg";
import type { InvoiceSourceKind } from "@yourtal/contracts/invoice";

/** A Pool or a checked-out client: whatever can run a query. */
export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

/** What an invoice is for. A source is invoiced once. */
export interface InvoiceSourceRef {
  readonly kind: InvoiceSourceKind;
  readonly id: string;
}

/** Everything an invoice needs from its source, read from the source's own rows. */
export interface SourceFacts {
  readonly region: "AU" | "ID";
  readonly businessId: string;
  readonly currency: "AUD" | "IDR";
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly taxRateBps: number;
  readonly paymentRef: string | null;
  readonly description: string;
}

export type SkipReason =
  | "source_not_found"
  | "not_paid"
  | "source_invalid"
  | "region_not_invoiced"
  | "issuer_not_configured"
  | "buyer_not_found";

export type IssueOutcome =
  | { readonly status: "issued"; readonly invoiceId: string; readonly number: string }
  | { readonly status: "exists"; readonly invoiceId: string; readonly number: string }
  | {
      readonly status: "skipped";
      readonly reason: SkipReason;
      /** Known once the source was read; null when it could not be. */
      readonly region: "AU" | "ID" | null;
    };
