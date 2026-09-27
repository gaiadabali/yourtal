import { counterDeviceSchema } from "../device/counter-device";
import {
  counterAuthorizationSchema,
  counterCaptureSchema,
  counterLogEntrySchema,
  counterVoucherPreviewSchema,
} from "../device/counter-redemption";
import { studioRedemptionEntrySchema } from "../device/studio-redemptions";
import {
  merchantDeveloperCredentialSchema,
  webhookSubscriptionSchema,
} from "../merchant/merchant-developer-credential";
import type { ContractComponent } from "./schema-registry";

/**
 * The devices/counter/studio-developers half of `CONTRACT_COMPONENTS`
 * (TASKS.md 8.1-8.3), split out for the same 300-line-ceiling reason
 * `schema-registry-business.ts` gives. Request bodies for these same routes
 * are documented inline (`inlineSchema()` in `route-registry.c.ts`) rather
 * than published here — see `openapi.test.ts`'s `NOT_PUBLISHED` entries for
 * each one and why.
 */
export const DEVICE_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "CounterDevice",
    schema: counterDeviceSchema,
    description:
      "A provisioned counter device (TASKS.md 8.1.a), as Studio -> Team -> Devices sees it — " +
      "never its credential secret or PIN hash, which never leave apps/api/src/modules/devices.",
    crossFieldRules: [],
  },
  {
    id: "CounterVoucherPreview",
    schema: counterVoucherPreviewSchema,
    description: "POST /api/counter/lookup's read-only preview — no hold placed (8.2.a).",
    crossFieldRules: [],
  },
  {
    id: "CounterAuthorization",
    schema: counterAuthorizationSchema,
    description: "POST /api/counter/authorize's 5-minute hold.",
    crossFieldRules: [],
  },
  {
    id: "CounterCapture",
    schema: counterCaptureSchema,
    description: "POST /api/counter/capture's receipt, on both the device and Studio sides.",
    crossFieldRules: [],
  },
  {
    id: "CounterLogEntry",
    schema: counterLogEntrySchema,
    description: "One row of GET /api/counter/log — today's captures at this device only.",
    crossFieldRules: [],
  },
  {
    id: "StudioRedemptionEntry",
    schema: studioRedemptionEntrySchema,
    description:
      "One row of GET /api/:tenantId/studio/redemptions (8.2.g) — recent captures per location and device.",
    crossFieldRules: [],
  },
  {
    id: "MerchantDeveloperCredential",
    schema: merchantDeveloperCredentialSchema,
    description:
      "Studio -> Developers' merchant HMAC credential (8.3.a), wrapping the voucher service's " +
      "own credential one-to-one. `secret` is present only on issue/rotate, never a later read.",
    crossFieldRules: [],
  },
  {
    id: "WebhookSubscription",
    schema: webhookSubscriptionSchema,
    description: "A business's registered webhook delivery URL (8.3.c).",
    crossFieldRules: [],
  },
];
