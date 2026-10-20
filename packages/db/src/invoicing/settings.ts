import { invoiceIssuerSchema } from "@yourtal/contracts/invoice";
import type { InvoiceIssuer } from "@yourtal/contracts/invoice";
import type { Queryable } from "./types";

/** Used only if the `gst_rate_bps` row is missing; the payment migration seeds the same numbers (F118). */
const FALLBACK_GST_RATE_BPS = { AU: 1_000, ID: 0 } as const;

async function currentSetting(db: Queryable, region: "AU" | "ID", key: string): Promise<unknown> {
  const { rows } = await db.query<{ value: unknown }>(
    `SELECT value FROM platform.region_setting
      WHERE region = $1 AND key = $2 AND approved_by IS NOT NULL AND effective_from <= now()
      ORDER BY effective_from DESC LIMIT 1`,
    [region, key],
  );
  return rows[0]?.value ?? null;
}

export async function gstRateBps(db: Queryable, region: "AU" | "ID"): Promise<number> {
  const value = await currentSetting(db, region, "gst_rate_bps");
  const rate: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, "rateBps") : null;
  return typeof rate === "number" && Number.isInteger(rate) && rate >= 0 && rate <= 10_000
    ? rate
    : FALLBACK_GST_RATE_BPS[region];
}

/**
 * The issuing company (`invoice_issuer`). Null when the setting is missing or
 * malformed: nothing is issued from a half-filled company, and the job
 * retries once staff approve a good value. An ABN may be typed with spaces.
 */
export async function issuerFor(db: Queryable, region: "AU" | "ID"): Promise<InvoiceIssuer | null> {
  const value = await currentSetting(db, region, "invoice_issuer");
  if (typeof value !== "object" || value === null) return null;
  const field = (name: string): unknown => Reflect.get(value, name);
  const abn = field("abn");
  const parsed = invoiceIssuerSchema.safeParse({
    legalName: field("legalName"),
    address: field("address"),
    email: field("email"),
    abn: typeof abn === "string" && abn.trim() !== "" ? abn.replace(/\s+/g, "") : null,
  });
  return parsed.success ? parsed.data : null;
}
