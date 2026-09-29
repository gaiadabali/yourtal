import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildDocument,
  countCrossFieldRefinements,
  isRecord,
  objectShapeKeys,
} from "./build-document";
import { CONTRACT_COMPONENTS } from "./schema-registry";

/**
 * The drift gate. YT-0031 AC3: "drift between schema and generated output
 * fails CI."
 *
 * Three separate things can drift, and each gets its own test, because they
 * fail for different reasons and a reviewer should be able to tell which at a
 * glance:
 *
 *   1. the checked-in document vs. what the schemas produce today;
 *   2. a schema exists but nobody put it in the document;
 *   3. a `.refine()` was added and its rule was not written down, so it
 *      vanishes from the document in silence.
 *
 * To regenerate after an intentional schema change:
 *
 *   pnpm --filter @yourtal/contracts openapi:update
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const documentPath = path.join(packageRoot, "openapi", "yourtal.openapi.json");
const srcDir = path.join(packageRoot, "src");

// Parsed rather than asserted: `as` is banned in this package (docs/13b
// section 2), and we have a schema library right here.
const packageJson = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")));

/** One component's schema object out of the built document. */
function componentSchema(id: string): Record<string, unknown> {
  const schema = buildDocument(packageJson.version).components.schemas[id];
  if (!isRecord(schema)) throw new Error(`no component schema for "${id}"`);
  return schema;
}

/**
 * Schemas deliberately kept out of the published contract, with the reason.
 * Anything added here is a decision someone has to defend in review, which
 * is the point of making it explicit rather than allowing the completeness
 * check to be loosened.
 */
/**
 * 1.2.a/1.2.b: every `ledger-internal` and `voucher-internal` operation type
 * (pricing, funding, rewards, wallet, economy, batches, lifecycle, redemption,
 * credentials, kill-switch, stats) plus the closed error enum they share
 * (1.2.c). These are the shape `FakeLedgerClient`/`HttpLedgerClient` and
 * their voucher twins speak to `services/ledger`/`services/voucher` over a
 * service-to-service boundary (4.1/4.5's HMAC-signed calls) -- never a
 * `/api/:tenantId/*` route a browser calls, so there is nothing here for
 * this registry (which documents the public/business-facing HTTP contract)
 * to publish. Same reasoning as `regionSettingSchema` below, which is why
 * that one lives in this same object rather than its own case.
 */
const LEDGER_AND_VOUCHER_INTERNAL_REASON =
  "ledger-internal/voucher-internal (1.2.a-c): an internal service-to-service operation type, not a public/business-facing HTTP contract -- see this file's comment above NOT_PUBLISHED.";

const NOT_PUBLISHED: Readonly<Record<string, string>> = {
  staffRoleSchema:
    "9.1's staff console session, read only by apps/web's own /staff shell; GET /api/staff/me documents it inline in route-registry.c-staff.ts.",
  staffSessionSchema: "Same as staffRoleSchema above.",
  staffBusinessSummarySchema:
    "9.3.a's staff Businesses zone: GET /api/staff/businesses documents its list item inline in route-registry.c-staff-businesses.ts, same as staffSessionSchema above.",
  staffBusinessDetailSchema:
    "9.3.a's staff Businesses zone: GET /api/staff/businesses/{businessId} and every review action's response, documented inline in route-registry.c-staff-businesses.ts.",
  listStaffBusinessesResponseSchema:
    "9.3.a's staff Businesses zone: GET /api/staff/businesses's response envelope, documented inline in route-registry.c-staff-businesses.ts.",
  approveBusinessKybRequestSchema:
    "9.3.a's staff Businesses zone: POST .../kyb/approve's request body, documented inline in route-registry.c-staff-businesses.ts.",
  rejectBusinessKybRequestSchema:
    "9.3.a's staff Businesses zone: POST .../kyb/reject's request body, documented inline in route-registry.c-staff-businesses.ts.",
  suspendBusinessRequestSchema:
    "9.3.a's staff Businesses zone: POST .../suspend's request body, documented inline in route-registry.c-staff-businesses.ts.",
  reinstateBusinessRequestSchema:
    "9.3.a's staff Businesses zone: POST .../reinstate's request body, documented inline in route-registry.c-staff-businesses.ts.",
  staffVoucherBatchRequestSchema:
    "9.2.c's staff moderation queue: documented inline in route-registry.c-staff-moderation.ts, same treatment as staffSessionSchema above.",
  listPendingVoucherBatchesResponseSchema:
    "9.2.c's staff moderation queue: GET .../voucher-batches's response envelope, documented inline in route-registry.c-staff-moderation.ts.",
  approveVoucherBatchRequestSchema:
    "9.2.c's staff moderation queue: POST .../approve's request body, documented inline in route-registry.c-staff-moderation.ts.",
  rejectVoucherBatchRequestSchema:
    "9.2.c's staff moderation queue: POST .../reject's request body, documented inline in route-registry.c-staff-moderation.ts.",
  campaignModerationFlagSchema:
    "9.2.a's staff moderation queue: one automated-screen flag on a campaign's question bank, documented inline in route-registry.c-staff-moderation.ts.",
  staffCampaignModerationCampaignSchema:
    "9.2.a's staff moderation queue: the campaign shape a moderator reviews, documented inline in route-registry.c-staff-moderation.ts.",
  campaignModerationQueueItemSchema:
    "9.2.a's staff moderation queue: one queue row (campaign + its flags), documented inline in route-registry.c-staff-moderation.ts.",
  listCampaignModerationQueueResponseSchema:
    "9.2.a's staff moderation queue: GET .../campaigns's response envelope, documented inline in route-registry.c-staff-moderation.ts.",
  approveCampaignModerationRequestSchema:
    "9.2.a's staff moderation queue: POST .../campaigns/{id}/approve's request body, documented inline in route-registry.c-staff-moderation.ts.",
  rejectCampaignModerationRequestSchema:
    "9.2.a's staff moderation queue: POST .../campaigns/{id}/reject's request body, documented inline in route-registry.c-staff-moderation.ts.",
  staffListingModerationItemSchema:
    "9.2.a's staff moderation queue: a listing the automated screen flagged, documented inline in route-registry.c-staff-moderation.ts.",
  listPendingListingModerationResponseSchema:
    "9.2.a's staff moderation queue: GET .../listings's response envelope, documented inline in route-registry.c-staff-moderation.ts.",
  approveListingModerationRequestSchema:
    "9.2.a's staff moderation queue: POST .../listings/{id}/approve's request body, documented inline in route-registry.c-staff-moderation.ts.",
  rejectListingModerationRequestSchema:
    "9.2.a's staff moderation queue: POST .../listings/{id}/reject's request body, documented inline in route-registry.c-staff-moderation.ts.",

  // --- staff/users, staff/disputes (9.4): documented inline in
  // route-registry.c-staff-users.ts via inlineSchema(), same reason
  // staffSessionSchema above is -- these are the staff console's own
  // internal screens, not a reusable public component.
  staffUserSearchQuerySchema: "9.4's staff users screen. See route-registry.c-staff-users.ts.",
  staffUserSummarySchema: "Same as staffUserSearchQuerySchema above.",
  staffUserSearchResultSchema: "Same as staffUserSearchQuerySchema above.",
  staffUserDetailSchema: "Same as staffUserSearchQuerySchema above.",
  staffUserLedgerHistorySchema: "Same as staffUserSearchQuerySchema above.",
  suspendUserRequestSchema: "Same as staffUserSearchQuerySchema above.",
  suspendUserResultSchema: "Same as staffUserSearchQuerySchema above.",
  releaseUserResultSchema: "Same as staffUserSearchQuerySchema above.",
  goodwillRequestSchema: "Same as staffUserSearchQuerySchema above.",
  goodwillResultSchema: "Same as staffUserSearchQuerySchema above.",
  setTrustTierRequestSchema: "Same as staffUserSearchQuerySchema above.",
  setTrustTierResultSchema: "Same as staffUserSearchQuerySchema above.",
  staffDisputeSchema: "Same as staffUserSearchQuerySchema above.",
  staffDisputeQueueSchema: "Same as staffUserSearchQuerySchema above.",
  resolveDisputeRequestSchema:
    "10.5.b's dispute resolve. Same as staffUserSearchQuerySchema above.",
  disputeResolutionResultSchema:
    "10.5.b's dispute resolve. Same as staffUserSearchQuerySchema above.",
  regionSettingSchema:
    "1.2.f's ledger-internal settings row (getSettings/proposeSetting/approveSetting). Internal to the ledger and 9.5.d's staff console, not a public/business-facing HTTP contract -- same reason ledger-internal and voucher-internal's own operation types are not routed through this registry.",

  // --- staff/staff-economy.ts (TASKS.md 9.5) ---
  economyProposalKindSchema:
    "staff-economy.ts's closed kind union, nested inside economyProposalSchema's own inline schema -- not a standalone component.",
  economyProposalStatusSchema: "Same as economyProposalKindSchema above.",
  economyProposalSchema:
    "9.5.b-d's pending-approval row. Documented inline wherever it appears (route-registry.c-staff-economy.ts), not a registered component -- staff.economy_proposal (migration 20260929060100) is a staff-only read model, same tier as regionSettingSchema above.",
  economyDaySchema:
    "staff-economy.ts's per-day row, nested inside economyOverviewSchema's own inline schema -- not a standalone component.",
  economyOverviewSchema:
    "9.5.a's overview response -- documented inline (route-registry.c-staff-economy.ts GET .../overview).",
  rateScreenSchema:
    "9.5.b's rate screen. F54: published inline (route-registry.c-staff-economy.ts GET .../rate), same 'documented but not a registered cross-route component' tier as every other staff-economy schema here -- never a NAMED component, so B can never be referenced from outside the two staff routes that carry it.",
  proposeRateBodySchema:
    "Same as rateScreenSchema above -- published inline (POST .../rate/proposals), not a registered component.",
  proposeMarketingFundingBodySchema:
    "9.5.c's request body -- documented inline (route-registry.c-staff-economy.ts POST .../marketing-fundings).",
  proposeManualPurchaseBodySchema:
    "9.5.c's request body -- documented inline (route-registry.c-staff-economy.ts POST .../purchases).",
  settingsScreenSchema:
    "9.5.d's settings screen -- documented inline (route-registry.c-staff-economy.ts GET .../settings).",
  proposeSettingBodySchema:
    "9.5.d's request body -- documented inline (route-registry.c-staff-economy.ts POST .../settings/proposals).",
  decideProposalBodySchema:
    "9.5's shared approve-route request body -- documented inline everywhere an approve route appears (route-registry.c-staff-economy.ts).",

  campaignPublishedEventSchema:
    "TASKS.md 7.3.f: a pg-boss job payload (campaign.published), consumed by apps/worker/src/jobs/campaign-published-notify.ts -- a queue message between two server processes, never an HTTP request/response body a client sends or receives.",

  // --- ledger-internal (1.2.a): pricing ---
  quoteRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  quoteSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  lockQuoteRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  priceListingRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  priceListingResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  quotePurchaseRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  quotePurchaseResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  valuePointsRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  valuePointsResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: funding and allocations ---
  funderTypeSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  purchasePointsRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  allocationSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  holdRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  holdSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  returnGrantRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  campaignSpendSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: earning and spending ---
  trustTierSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  grantKindSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  grantRewardRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  rewardAttestationSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  grantActionRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  grantSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  burnForVoucherRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  burnSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- staff/risk-queue.ts (TASKS.md 10.5.a): the manual-review queue
  // screen, documented inline in route-registry.c-staff-risk.ts, same
  // treatment as staffSessionSchema above.
  staffRiskSignalSchema:
    "10.5.a's staff risk queue: documented inline in route-registry.c-staff-risk.ts, same as staffSessionSchema above.",
  staffRiskFlagSchema: "Same as staffRiskSignalSchema above.",
  staffRiskQueueSchema:
    "10.5.a's GET /api/staff/risk/queue response, documented inline in route-registry.c-staff-risk.ts.",
  staffRiskResolveRequestSchema:
    "10.5.a's release/suspend request body, documented inline in route-registry.c-staff-risk.ts.",
  staffRiskResolveResultSchema:
    "10.5.a's release/suspend response, documented inline in route-registry.c-staff-risk.ts.",

  // --- ledger-internal: points expiry (10.2.d) and the RiskGate queue (10.4/10.5) ---
  milestoneDaysSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  expiryNoticeSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  unnotifiedPointsExpiryRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  unnotifiedPointsExpirySchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  pointsExpiryNotifiedRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  pointsExpiryNotifiedSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  pointsExpiringEventSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  riskSignalSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  riskFlagSeveritySchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  riskFlagStatusSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  riskFlagSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  riskQueueListRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  riskQueueListSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  riskQueueResolveRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- studio media pipeline (TASKS.md 7.2): worker -> api internal callback ---
  mediaReadyCallbackRequestSchema:
    "7.2.b's POST /internal/studio/media/:assetId/ready, called by apps/worker over the loopback " +
    "media-service-signature HMAC -- never a /api/:tenantId/* route a browser calls, same " +
    "reasoning as the ledger-internal/voucher-internal types above.",
  mediaTranscodeJobSchema:
    "7.2.b's pg-boss job payload (studio.media_transcode) -- a queue message between apps/api " +
    "and apps/worker, never an HTTP route.",

  // --- ledger-internal: captures (4.6.f.2), posted by the voucher service ---
  captureVoucherRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  capturePostingSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  recoverCaptureRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  captureRecoveryPostingSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: dev/staging holdback control (2.3.d/2.3.f) ---
  advanceHoldbackRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  advanceHoldbackResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: holdback release notices (4.4.g) ---
  releaseSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  unnotifiedReleasesRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  unnotifiedReleasesSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  releasesNotifiedRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  releasesNotifiedSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  pointsUnlockedEventSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: users (wallet) ---
  escrowRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  escrowSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  pendingBucketSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  ledgerBalanceSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  historyEntryKindSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  historyEntrySchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  historyRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: economy ---
  coverageSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  economyDailyRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  economyDayRowSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  proposeRateRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  rateProposalSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  approveRateRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  fundMarketingRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  statementsRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  statementSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  generateStatementRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  disputeStatementRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  resolveStatementDisputeRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  approvePayoutRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  releaseVoucherLiabilityRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal/voucher-internal (1.2.c): the shared closed error enum ---
  ledgerErrorCodeSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  ledgerErrorSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal (1.2.b): batches ---
  requestBatchRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  batchSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  approveBatchRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: lifecycle ---
  reserveRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  reservationSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  releaseRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  activateRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  revealRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  revealedCodeSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  qrTokenRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  qrTokenSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  qrTokenWindowSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  verifyQrTokenRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  verifyQrTokenResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  voidVoucherRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: wallet ---
  walletVoucherRowSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  listForUserRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  listForUserResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  getVoucherRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: device-authorized redemption ---
  lookupAsDeviceRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  voucherPreviewSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  authorizeAsDeviceRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  authorizationSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  captureAsDeviceRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  captureSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: kill switches ---
  killSwitchScopeSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  setKillSwitchRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  killSwitchSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: merchant credentials ---
  issueMerchantCredentialRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  merchantCredentialSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  rotateCredentialRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  revokeCredentialRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: merchant stats ---
  merchantCaptureStatsRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  merchantCaptureStatsSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: webhook outbox drain (TASKS.md 8.3.e) ---
  webhookOutboxEventSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  unpostedWebhookEventsRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  unpostedWebhookEventsSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  webhookEventsPostedRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  webhookEventsPostedSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- me (TASKS.md 6.7.a) ---
  autoplaySettingSchema:
    "MeModule -- TASKS.md 6.7.a, this pass's own ticket. GET/PUT /api/me/settings/autoplay is in route-drift.test.ts's KNOWN_OUT_OF_SCOPE ledger (same convention as every other MeModule route from 5.4/5.5) -- no packages/contracts/src/openapi route-registry entry exists for it to be published from.",

  // --- device (TASKS.md 8.1-8.4): request bodies, documented inline via
  // inlineSchema() in route-registry.c.ts rather than published as their
  // own component — same convention route-registry.c.ts's own header
  // states for business's request DTOs, except these ARE exported (apps/api's
  // nestjs-zod DTOs import them directly rather than route-registry.c.ts
  // re-typing the shape by hand), so they need a ledger entry here too.
  provisionDeviceRequestSchema:
    "device/counter-device.ts's request body for POST /studio/devices — documented inline (route-registry.c.ts).",
  provisionDeviceResultSchema:
    "device/counter-device.ts's response for POST /studio/devices — documented inline " +
    "(route-registry.c.ts's provisionDeviceResponseSchema); CounterDevice, its own nested field, is published.",
  pairDeviceRequestSchema:
    "device/counter-device.ts's request body for POST /api/devices/pair — documented inline (route-registry.c.ts).",
  pairDeviceResultSchema:
    "device/counter-device.ts's response for POST /api/devices/pair — documented inline " +
    "(route-registry.c.ts's pairDeviceResponseSchema).",
  unlockDeviceRequestSchema:
    "device/counter-device.ts's request body for POST /api/devices/unlock — documented inline (route-registry.c.ts).",
  unlockDeviceResultSchema:
    "device/counter-device.ts's response for POST /api/devices/unlock — documented inline (route-registry.c.ts).",
  counterDeviceStateSchema:
    "device/counter-device.ts's nested enum on the published CounterDevice.state — not a standalone component.",

  // --- device: counter BFF (TASKS.md 8.2) — a paired device only, never a
  // published/external contract the way the merchant HMAC network's own
  // signing spec is; request bodies documented inline where a route exists.
  counterLookupRequestSchema:
    "device/counter-redemption.ts's request body for POST /api/counter/lookup — B's counter UI consumes it directly; not yet wired into route-registry.c.ts (8.2.b is server-only this phase).",
  counterAuthorizeRequestSchema:
    "device/counter-redemption.ts's request body for POST /api/counter/authorize — same as counterLookupRequestSchema above.",
  counterCaptureRequestSchema:
    "device/counter-redemption.ts's request body for POST /api/counter/capture — same as counterLookupRequestSchema above.",
  counterLogResultSchema:
    "device/counter-redemption.ts's envelope for GET /api/counter/log — CounterLogEntry, its array element, is published.",

  // --- device: studio redemptions (TASKS.md 8.2.g) ---
  studioRedemptionQuerySchema:
    "device/studio-redemptions.ts's query params for GET /studio/redemptions — not yet wired into route-registry.c.ts.",
  studioRedemptionListSchema:
    "device/studio-redemptions.ts's envelope for GET /studio/redemptions — StudioRedemptionEntry, its array element, is published.",

  // --- device: partner actions (TASKS.md 8.4.a) ---
  partnerActionTypeSchema:
    "device/partner-action.ts's nested enum on PartnerActionRequest.action — not a standalone component.",
  partnerActionRequestSchema:
    "device/partner-action.ts's request body for POST /api/partners/actions — documented inline (route-registry.c-partners.ts).",
  partnerActionResultSchema:
    "device/partner-action.ts's response for POST /api/partners/actions — documented inline (route-registry.c-partners.ts).",

  // --- merchant: Studio Developers (TASKS.md 8.3.a/c) ---
  merchantCredentialStateSchema:
    "merchant/merchant-developer-credential.ts's nested enum on the published MerchantDeveloperCredential.state — not a standalone component.",
  issueDeveloperCredentialRequestSchema:
    "merchant/merchant-developer-credential.ts's request body for POST /studio/developers/credentials — documented inline (route-registry.c-developers.ts).",
  rotateDeveloperCredentialResultSchema:
    "merchant/merchant-developer-credential.ts's response for the rotate route — a bare alias of the " +
    "already-published MerchantDeveloperCredential, so it is not a second component.",
  registerWebhookRequestSchema:
    "merchant/merchant-developer-credential.ts's request body for POST /studio/developers/webhooks — documented inline (route-registry.c-developers.ts).",
  webhookEventTypeSchema:
    "merchant/merchant-developer-credential.ts's closed event-type union, documented in the webhook delivery worker's own spec, not a request/response component.",
  webhookSignatureHeaderSchema:
    "merchant/merchant-developer-credential.ts's header-format regex for packages/sdk-merchant to verify against — not a JSON body component.",

  // --- device: webhook delivery (TASKS.md 8.3.c) ---
  webhookDeliveryEventSchema:
    "device/webhook-delivery-event.ts's internal pg-boss job payload (apps/api's producer to apps/worker's consumer) — not an HTTP request/response shape at all.",
};

function exportedSchemaNames(): string[] {
  const names: string[] = [];
  for (const domain of readdirSync(srcDir, { withFileTypes: true })) {
    if (!domain.isDirectory() || domain.name === "internal" || domain.name === "openapi") continue;
    for (const file of readdirSync(path.join(srcDir, domain.name))) {
      // Mock builders and tests are development scaffolding, not contract.
      if (!file.endsWith(".ts") || file.endsWith(".mock.ts") || file.endsWith(".test.ts")) continue;
      const source = readFileSync(path.join(srcDir, domain.name, file), "utf8");
      for (const match of source.matchAll(/^export const (\w+Schema)\b/gm)) {
        const name = match[1];
        if (name !== undefined) names.push(name);
      }
    }
  }
  return names;
}

/** `campaignKindSchema` -> `CampaignKind`, matching the registry's ids. */
function componentIdFor(schemaName: string): string {
  const base = schemaName.replace(/Schema$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

describe("the generated OpenAPI document", () => {
  it("matches what the Zod schemas produce right now", () => {
    const generated = buildDocument(packageJson.version);

    if (process.env.UPDATE_OPENAPI === "1") {
      writeFileSync(documentPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
    }

    const checkedIn: unknown = JSON.parse(readFileSync(documentPath, "utf8"));
    expect(
      checkedIn,
      "openapi/yourtal.openapi.json is stale. A schema changed without the document being " +
        "regenerated — run `pnpm --filter @yourtal/contracts openapi:update` and commit the result.",
    ).toEqual(generated);
  });

  it("is OpenAPI 3.1, because 3.0 would need a lossy rewrite", () => {
    expect(buildDocument(packageJson.version).openapi).toBe("3.1.0");
  });
});

describe("registry completeness", () => {
  it("every exported schema is either published or explicitly not", () => {
    const published = new Set(CONTRACT_COMPONENTS.map((component) => component.id));
    const missing = exportedSchemaNames()
      .filter((name) => NOT_PUBLISHED[name] === undefined)
      .filter((name) => !published.has(componentIdFor(name)));

    // Catches the realistic failure: someone adds a schema in another session,
    // it never reaches the document, and a Go service silently has no type for
    // it. Register it in schema-registry.ts, or list it in NOT_PUBLISHED with
    // a reason.
    expect(missing).toEqual([]);
  });

  it("component ids are unique", () => {
    const ids = CONTRACT_COMPONENTS.map((component) => component.id);
    expect(ids).toEqual([...new Set(ids)]);
  });
});

describe("cross-field rules", () => {
  // The rules JSON Schema cannot carry. If these counts disagree, a .refine()
  // was added or removed without the prose being updated — which means the
  // generated Go and TypeScript are quietly weaker than the Zod schema and
  // nothing else in the toolchain would have said so.
  it.each(CONTRACT_COMPONENTS.map((component) => [component.id, component] as const))(
    "%s documents every refinement it carries",
    (_id, component) => {
      expect(component.crossFieldRules).toHaveLength(countCrossFieldRefinements(component.schema));
    },
  );

  it("reaches the document, where generated code can see it", () => {
    const listing = componentSchema("Listing");

    expect(listing.description).toContain("cannot exceed faceValueMinor");
    expect(listing.description).toContain("NOT enforced by this schema");
  });

  it("finds the refinements hidden inside a discriminated union", () => {
    // Question's refinements sit on the union MEMBERS, not the union. A naive
    // count returns zero here and the whole check becomes decorative.
    const question = CONTRACT_COMPONENTS.find((component) => component.id === "Question");
    expect(countCrossFieldRefinements(question?.schema)).toBeGreaterThan(0);
  });
});

describe("faithfulness to the Zod schemas", () => {
  // The drift test proves the checked-in document matches what the generator
  // produces. It does NOT prove the generator produced the right thing — a
  // silently dropped field would pass it, because the document and the
  // regenerated document would agree with each other and both be wrong.
  //
  // This compares the document back against the Zod shapes directly, which is
  // the only check here that would catch zod changing what it emits.
  const objectComponents = CONTRACT_COMPONENTS.filter(
    (component) => objectShapeKeys(component.schema) !== undefined,
  );

  it("covers every object component", () => {
    // Guards the guard: if introspection silently stops working, the loop
    // below would pass vacuously over an empty list.
    expect(objectComponents.length).toBeGreaterThanOrEqual(6);
  });

  it.each(objectComponents.map((component) => [component.id, component] as const))(
    "%s exposes exactly the fields its Zod schema declares",
    (id, component) => {
      const properties = componentSchema(id).properties;
      const documented = isRecord(properties) ? Object.keys(properties).sort() : [];

      expect(documented).toEqual(objectShapeKeys(component.schema));
    },
  );
});

describe("integer width", () => {
  const INT32_MAX = 2_147_483_647;

  /** Every `{type: "integer"}` anywhere in the document, with its path. */
  function integerNodes(
    node: unknown,
    at = "$",
  ): { path: string; node: Record<string, unknown> }[] {
    if (Array.isArray(node)) {
      return node.flatMap((child, index) => integerNodes(child, `${at}[${String(index)}]`));
    }
    if (!isRecord(node)) return [];

    const here = node.type === "integer" ? [{ path: at, node }] : [];
    return [
      ...here,
      ...Object.entries(node).flatMap(([key, value]) => integerNodes(value, `${at}.${key}`)),
    ];
  }

  it("no integer that exceeds int32 is left without int64", () => {
    // Generators default `{"type":"integer"}` to int32. Our money types allow
    // 10,000,000,000 — about five times what an int32 holds — so without an
    // explicit int64 a generated Go struct would silently truncate a real
    // Rupiah amount. Caught once, in review; this keeps it caught.
    const offenders = integerNodes(buildDocument(packageJson.version).components.schemas)
      .filter(({ node }) => {
        const max = node.maximum;
        return typeof max !== "number" || max > INT32_MAX;
      })
      .filter(({ node }) => node.format !== "int64")
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("marks the money types int64 specifically", () => {
    expect(componentSchema("Points")).toMatchObject({ type: "integer", format: "int64" });
    expect(componentSchema("IdrMinorUnits")).toMatchObject({ type: "integer", format: "int64" });
  });

  it("leaves small bounded integers alone", () => {
    // Widening everything would be the lazy fix, and would make every small
    // count field an int64 for no reason. A campaign's questionCount maxes
    // at 5 (F10, TASKS.md 1.1.f) and stays a plain integer.
    const properties = componentSchema("Campaign").properties;
    const questionCount = isRecord(properties) ? properties.questionCount : undefined;

    expect(questionCount).toMatchObject({ type: "integer", maximum: 5 });
    expect(isRecord(questionCount) ? questionCount.format : "missing").toBeUndefined();
  });
});
