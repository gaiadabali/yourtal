import { BadRequestException } from "@nestjs/common";
import {
  PACKAGE_TIERS_SETTING_KEY,
  packageTierCatalogueSchema,
} from "@yourtal/contracts/billing/package-tiers";
import {
  INVOICE_ISSUER_SETTING_KEY,
  invoiceIssuerSettingSchema,
} from "@yourtal/contracts/invoice/issuer-setting";
import {
  RECEIPT_FUNDER_KEY_PREFIX,
  receiptFunderValueSchema,
} from "@yourtal/contracts/billing/receipt-funder";
import {
  POINTS_IDENTITY_CHECK_SETTING_KEY,
  pointsIdentityCheckSettingSchema,
} from "@yourtal/contracts/identity/earning-check";
import type { Region } from "@yourtal/contracts/region";
import type { ZodError } from "zod";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";

function invalid(key: string, error: ZodError): BadRequestException {
  const issues = error.issues
    .map((issue) => `${issue.path.join(".")} ${issue.message}`.trim())
    .join("; ");
  return new BadRequestException({ code: "invalid_setting", message: `${key}: ${issues}` });
}

/** The reads a receipt funder needs: does the partner exist, and what is the business. */
export interface ReceiptFunderFacts {
  partnerExists(partnerId: string): Promise<boolean>;
  /** `null` when no business has this id. */
  businessFacts(businessId: string): Promise<{ region: Region; isVerified: boolean } | null>;
}

const RECEIPT_POINTS_SETTING_KEY = "receipt_points";
/** A receipt package holds this many points per tier unit, so receipt_points must divide it evenly. */
const RECEIPT_PACKAGE_UNIT_POINTS = 1000;

function refuse(key: string, why: string): BadRequestException {
  return new BadRequestException({ code: "invalid_setting", message: `${key}: ${why}` });
}

/** 2.10.b (docs/27 3.1): a package of 1,000 points must pay out in whole receipts. */
function assertReceiptPoints(value: unknown): void {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    RECEIPT_PACKAGE_UNIT_POINTS % value !== 0
  ) {
    throw refuse(
      RECEIPT_POINTS_SETTING_KEY,
      `must be a positive whole number that divides ${String(RECEIPT_PACKAGE_UNIT_POINTS)}`,
    );
  }
}

/**
 * 2.10.b (docs/27 3.1): `receipt_funder.<partnerId>` names the business that
 * pays for the partner's receipts. The partner must exist, the value must be
 * exactly `{businessId}` (lowercase uuid), and that business must exist, be
 * verified, and sit in the setting's own region.
 */
async function assertReceiptFunder(
  funders: ReceiptFunderFacts,
  region: Region,
  key: string,
  value: unknown,
): Promise<void> {
  const partnerId = key.slice(RECEIPT_FUNDER_KEY_PREFIX.length);
  if (partnerId === "" || !(await funders.partnerExists(partnerId))) {
    throw refuse(key, `partner "${partnerId}" does not exist`);
  }
  const parsed = receiptFunderValueSchema.safeParse(value);
  if (!parsed.success) throw invalid(key, parsed.error);
  const business = await funders.businessFacts(parsed.data.businessId);
  if (business === null) throw refuse(key, "businessId does not name an existing business");
  if (!business.isVerified) throw refuse(key, "the business is not verified");
  if (business.region !== region) {
    throw refuse(key, `the business is not in region ${region}`);
  }
}

/**
 * 14.13 (F122), 5.3.c (F118): a setting the economy depends on is checked
 * before it is proposed and again before it is approved, since B may have
 * moved between the two. The tier catalogue's shape is checked here; whether
 * every tier stays above B only the ledger can say, and it says so without
 * sharing B. The ledger refuses an under-B tier at sale time whatever is
 * approved. The invoice issuer must be a whole company: invoices are issued
 * from it, and a half-filled one would stop them.
 */
export async function assertSettingValue(
  ledger: Pick<LedgerInternalClient, "checkPackageTiers">,
  region: Region,
  key: string,
  value: unknown,
  funders: ReceiptFunderFacts,
): Promise<void> {
  if (key.startsWith(RECEIPT_FUNDER_KEY_PREFIX)) {
    await assertReceiptFunder(funders, region, key, value);
    return;
  }
  if (key === RECEIPT_POINTS_SETTING_KEY) {
    assertReceiptPoints(value);
    return;
  }
  if (key === INVOICE_ISSUER_SETTING_KEY) {
    const parsed = invoiceIssuerSettingSchema.safeParse(value);
    if (!parsed.success) throw invalid(key, parsed.error);
    return;
  }
  // F126: on or off, nothing else; production requires the check whatever this says.
  if (key === POINTS_IDENTITY_CHECK_SETTING_KEY) {
    const parsed = pointsIdentityCheckSettingSchema.safeParse(value);
    if (!parsed.success) throw invalid(key, parsed.error);
    return;
  }
  if (key !== PACKAGE_TIERS_SETTING_KEY) return;
  const parsed = packageTierCatalogueSchema.safeParse(value);
  if (!parsed.success) throw invalid(key, parsed.error);
  const checked = await ledger.checkPackageTiers({ region, tiers: parsed.data });
  if (checked.isErr()) {
    throw new BadRequestException({
      code: "invalid_setting",
      message: `point_package_tiers: ${checked.error.message}`,
    });
  }
}
