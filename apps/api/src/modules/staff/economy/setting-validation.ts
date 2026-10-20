import { BadRequestException } from "@nestjs/common";
import {
  PACKAGE_TIERS_SETTING_KEY,
  packageTierCatalogueSchema,
} from "@yourtal/contracts/billing/package-tiers";
import type { Region } from "@yourtal/contracts/region";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";

/**
 * 14.13 (F122): a setting the economy depends on is checked before it is
 * proposed and again before it is approved, since B may have moved between
 * the two. The tier catalogue's shape is checked here; whether every tier
 * stays above B only the ledger can say, and it says so without sharing B.
 * The ledger refuses an under-B tier at sale time whatever is approved.
 */
export async function assertSettingValue(
  ledger: Pick<LedgerInternalClient, "checkPackageTiers">,
  region: Region,
  key: string,
  value: unknown,
): Promise<void> {
  if (key !== PACKAGE_TIERS_SETTING_KEY) return;
  const parsed = packageTierCatalogueSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "invalid_setting",
      message: `point_package_tiers: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
    });
  }
  const checked = await ledger.checkPackageTiers({ region, tiers: parsed.data });
  if (checked.isErr()) {
    throw new BadRequestException({
      code: "invalid_setting",
      message: `point_package_tiers: ${checked.error.message}`,
    });
  }
}
