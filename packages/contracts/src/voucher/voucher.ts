import { z } from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { partialRedemptionPolicySchema } from "../listing/listing";
import { merchantLocationSchema } from "../listing/merchant-location";

/**
 * A voucher is a bearer instrument minted when a user redeems points against
 * a listing (docs/09 section 7). It is deliberately a separate schema from
 * `Listing`: a listing is catalogue inventory, a voucher is one user's
 * held claim against it, with its own code, remaining value and lifecycle.
 */
export const voucherStatusSchema = z.enum(["active", "redeemed", "expired", "transferred"]);
export type VoucherStatus = z.infer<typeof voucherStatusSchema>;

const MAX_MERCHANT_NAME_LENGTH = 120;

export const voucherSchema = z
  .object({
    id: z.uuid(),
    listingId: z.uuid(),
    ownerId: z.uuid(),
    code: z.string().min(6).max(24),
    /**
     * **The identity a redemption is authorized against.** Same identifier as
     * `listingSchema.merchantId`, `campaignSchema.merchantId` and the
     * `businessId` the policy repo scopes on — one merchant, one id, no
     * mapping layer.
     *
     * It exists because the merchant portal was otherwise forced to decide
     * "is this voucher valid at this shop" by comparing `merchantName`, and a
     * redemption decision made on a display label breaks in ordinary ways
     * rather than exotic ones: two merchants sharing a name redeem each
     * other's vouchers; renaming an outlet silently invalidates every voucher
     * already sitting in customers' wallets, with no migration path because
     * the name IS the key; and a trailing space or a unicode variant is a
     * rejection at the counter with a customer standing there. The repo
     * already knows these strings are messy — `longMerchantNameCampaignFixture`
     * is a 78-character name kept specifically to break layouts.
     *
     * `merchantName` stays, for display. It is not an identifier and must
     * never be compared to authorize anything.
     */
    merchantId: z.uuid(),
    merchantName: z.string().min(1).max(MAX_MERCHANT_NAME_LENGTH),
    /**
     * YT-0502: which of the merchant's branches honours THIS voucher —
     * chosen from `listingSchema.locations` at issuance and denormalised
     * here for the same reason `merchantName` is: the voucher must stay
     * honourable offline (docs/17 section 3's wallet QR), so everything a
     * counter needs travels with it rather than being looked up from a
     * listing that may have changed since.
     */
    location: merchantLocationSchema,
    title: z.string().min(1).max(140),
    /**
     * YT-0513. One currency per voucher, for the same reason
     * `listingSchema` carries one per listing: separate currency fields per
     * amount would permit a voucher whose face value is AUD and whose
     * remaining value is IDR, and nothing would reject it.
     *
     * Denormalised like everything else here. A voucher is a bearer
     * instrument that must remain honourable offline (`docs/17` §3), so the
     * currency its amounts are in travels with it rather than being looked
     * up from a listing that may have changed.
     */
    currency: currencySchema,
    faceValueMinor: minorUnitsSchema,
    remainingValueMinor: minorUnitsSchema,
    partialRedemptionPolicy: partialRedemptionPolicySchema,
    /**
     * The threshold a `minimum_spend` voucher must be spent against, carried
     * on the voucher rather than looked up from the listing.
     *
     * `listingSchema` has the same field and the same invariant. Without it
     * here, a counter holding a `minimum_spend` voucher knows the policy but
     * not the number, so the portal can only fall back to treating it as
     * full-value-only — safe, but not what the merchant agreed to sell.
     *
     * Denormalised on purpose: a voucher is a bearer instrument that must
     * remain honourable offline (`docs/17` §3, the wallet's offline QR), so
     * everything needed to honour it travels with it. A later edit to the
     * listing must not change the terms of a voucher already issued.
     */
    minimumSpendMinor: minorUnitsSchema.nullable(),
    transferable: z.boolean(),
    status: voucherStatusSchema,
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .refine((voucher) => voucher.remainingValueMinor <= voucher.faceValueMinor, {
    message: "remainingValueMinor cannot exceed faceValueMinor",
    path: ["remainingValueMinor"],
  })
  .refine(
    (voucher) => new Date(voucher.expiresAt).getTime() > new Date(voucher.issuedAt).getTime(),
    {
      message: "expiresAt must be after issuedAt",
      path: ["expiresAt"],
    },
  )
  .refine(
    (voucher) =>
      (voucher.partialRedemptionPolicy === "minimum_spend") ===
      (voucher.minimumSpendMinor !== null),
    {
      // The same invariant listingSchema enforces. A minimum_spend voucher
      // with no threshold cannot be honoured; a threshold on any other policy
      // is a number the counter would have to decide whether to obey.
      message: "minimumSpendMinor must be set if and only if the policy is minimum_spend",
      path: ["minimumSpendMinor"],
    },
  );

export type Voucher = z.infer<typeof voucherSchema>;
