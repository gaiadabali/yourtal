import type { Pool } from "pg";
import { invoiceSchema } from "@yourtal/contracts/invoice";
import type { Invoice } from "@yourtal/contracts/invoice";
import type { Region } from "@yourtal/contracts/region";

export const INVOICE_REPOSITORY = Symbol("INVOICE_REPOSITORY");
export const INVOICES_DB_POOL = Symbol("INVOICES_DB_POOL");

interface InvoiceRow {
  id: string;
  number: string;
  region: string;
  business_id: string;
  source_kind: string;
  issued_at: Date;
  currency: string;
  subtotal_minor: string;
  tax_minor: string;
  total_minor: string;
  tax_rate_bps: number;
  is_tax_invoice: boolean;
  issuer_legal_name: string;
  issuer_abn: string | null;
  issuer_address: string;
  issuer_email: string;
  buyer_legal_name: string;
  buyer_abn: string | null;
  payment_ref: string | null;
  lines: {
    position: number;
    description: string;
    quantity: string;
    unit_minor: string;
    subtotal_minor: string;
    tax_minor: string;
  }[];
}

/** Invoice, lines included, as one row. Newest first. */
const SELECT_INVOICES = `
  SELECT i.id::text, i.number, i.region, i.business_id::text, i.source_kind, i.issued_at,
         i.currency, i.subtotal_minor::text, i.tax_minor::text, i.total_minor::text,
         i.tax_rate_bps, i.is_tax_invoice, i.issuer_legal_name, i.issuer_abn, i.issuer_address,
         i.issuer_email, i.buyer_legal_name, i.buyer_abn, i.payment_ref,
         (SELECT json_agg(json_build_object(
                   'position', l.position, 'description', l.description,
                   'quantity', l.quantity::text, 'unit_minor', l.unit_minor::text,
                   'subtotal_minor', l.subtotal_minor::text, 'tax_minor', l.tax_minor::text)
                 ORDER BY l.position)
            FROM invoice.line l WHERE l.invoice_id = i.id) AS lines
    FROM invoice.invoice i`;

/** Parsed, not cast: a row that does not match its contract fails here, not in a browser. */
function toInvoice(row: InvoiceRow): Invoice {
  return invoiceSchema.parse({
    id: row.id,
    number: row.number,
    region: row.region,
    businessId: row.business_id,
    sourceKind: row.source_kind,
    issuedAt: row.issued_at.toISOString(),
    currency: row.currency,
    subtotalMinor: Number(row.subtotal_minor),
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    taxRateBps: row.tax_rate_bps,
    isTaxInvoice: row.is_tax_invoice,
    issuer: {
      legalName: row.issuer_legal_name,
      abn: row.issuer_abn,
      address: row.issuer_address,
      email: row.issuer_email,
    },
    buyer: { legalName: row.buyer_legal_name, abn: row.buyer_abn },
    paymentRef: row.payment_ref,
    lines: row.lines.map((line) => ({
      position: line.position,
      description: line.description,
      quantity: Number(line.quantity),
      unitMinor: Number(line.unit_minor),
      subtotalMinor: Number(line.subtotal_minor),
      taxMinor: Number(line.tax_minor),
    })),
  });
}

export interface StaffInvoiceFilter {
  readonly region?: Region | undefined;
  readonly businessId?: string | undefined;
  readonly limit: number;
}

/** `invoice.invoice` and its lines, read only: an issued invoice never changes. */
export class InvoiceRepository {
  constructor(private readonly pool: Pool) {}

  /** A business sees its own invoices and nobody else's: the id is part of every query. */
  async listForBusiness(businessId: string, limit = 200): Promise<Invoice[]> {
    const { rows } = await this.pool.query<InvoiceRow>(
      `${SELECT_INVOICES} WHERE i.business_id = $1 ORDER BY i.issued_at DESC, i.number DESC LIMIT $2`,
      [businessId, limit],
    );
    return rows.map(toInvoice);
  }

  async findForBusiness(businessId: string, id: string): Promise<Invoice | null> {
    const { rows } = await this.pool.query<InvoiceRow>(
      `${SELECT_INVOICES} WHERE i.business_id = $1 AND i.id = $2`,
      [businessId, id],
    );
    return rows[0] === undefined ? null : toInvoice(rows[0]);
  }

  async listForStaff(filter: StaffInvoiceFilter): Promise<Invoice[]> {
    const { rows } = await this.pool.query<InvoiceRow>(
      `${SELECT_INVOICES}
        WHERE ($1::text IS NULL OR i.region = $1) AND ($2::uuid IS NULL OR i.business_id = $2)
        ORDER BY i.issued_at DESC, i.number DESC LIMIT $3`,
      [filter.region ?? null, filter.businessId ?? null, filter.limit],
    );
    return rows.map(toInvoice);
  }

  async findForStaff(id: string): Promise<Invoice | null> {
    const { rows } = await this.pool.query<InvoiceRow>(`${SELECT_INVOICES} WHERE i.id = $1`, [id]);
    return rows[0] === undefined ? null : toInvoice(rows[0]);
  }
}
