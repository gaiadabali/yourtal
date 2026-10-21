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
): Promise<void> {
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
