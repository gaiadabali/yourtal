import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { Allocation } from "@yourtal/contracts/ledger-internal/funding";
import { toPoints } from "@yourtal/contracts/money";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { CampaignFundingController } from "./campaign-funding.controller";

/**
 * 2.10.b (F127): a receipt package funds receipt points only, so the list a
 * marketer picks a campaign's reward from must leave it out. Stub ledger; the
 * e2e in studio-campaign-authoring covers the HTTP route.
 */
const BASE: Allocation = {
  allocationId: "alloc-ordinary",
  businessId: "business-1",
  region: "AU",
  funderType: "partner",
  totalPoints: toPoints(10_000),
  remainingPoints: toPoints(10_000),
  programme: null,
  createdAt: new Date().toISOString(),
};

describe("CampaignFundingController.list (2.10.b F127)", () => {
  it("hides a receipt package and keeps an ordinary partner allocation", async () => {
    const ledger: Pick<LedgerInternalClient, "listAllocations"> = {
      listAllocations: () =>
        okAsync([BASE, { ...BASE, allocationId: "alloc-receipts", programme: "receipts" }]),
    };
    const controller = new CampaignFundingController(ledger as LedgerInternalClient);

    const rows = await controller.list("business-1");

    expect(rows.map((row) => row.allocationId)).toEqual(["alloc-ordinary"]);
  });
});
