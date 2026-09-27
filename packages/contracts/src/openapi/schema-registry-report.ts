import {
  campaignReportResultSchema,
  campaignReportSchema,
  campaignReportSuppressedSchema,
} from "../report/campaign-report";
import type { ContractComponent } from "./schema-registry";

/**
 * The report-domain half of `CONTRACT_COMPONENTS` (7.6), split out of
 * `schema-registry.ts` for the same 300-line-ceiling reason
 * `schema-registry-business.ts` gives.
 */
export const REPORT_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "CampaignReport",
    schema: campaignReportSchema,
    description:
      "A business's own per-campaign aggregates (7.6.a) -- rewarded views, completions, question accuracy and points spent. Never a per-user row.",
    crossFieldRules: [],
  },
  {
    id: "CampaignReportSuppressed",
    schema: campaignReportSuppressedSchema,
    description:
      "Returned in place of CampaignReport when the underlying population is below the F12 cohort floor (10, teens 20).",
    crossFieldRules: [],
  },
  {
    id: "CampaignReportResult",
    schema: campaignReportResultSchema,
    description:
      "GET .../studio/reports/campaigns/:campaignId's actual response shape -- CampaignReport or CampaignReportSuppressed, discriminated on `suppressed`.",
    crossFieldRules: [],
  },
];
