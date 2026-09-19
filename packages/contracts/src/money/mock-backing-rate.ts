/**
 * The illustrative backing rate the mock catalogues price against —
 * deliberately dependency-free, so `apps/web` can import it without pulling
 * the Zod runtime into a client bundle.
 *
 * ## Why this is a module and not a constant in four files
 *
 * It was a constant in four files: `listing.mock.ts`, `wallet-history.mock.ts`,
 * `apps/web/features/burn/burn-data.ts` and
 * `apps/web/features/console/campaign-builder/campaign-reward-risk.ts` each
 * declared `MOCK_BACKING_RATE_IDR_PER_POINT = 6`, the last with a comment
 * explaining that it was copied rather than imported to avoid the Zod
 * dependency. That reasoning was sound and the conclusion was one step short:
 * the fix for "I cannot import this without taking on Zod" is a module with
 * no Zod in it.
 *
 * YT-0506 is what made it urgent. `pointsPriceFromSettlement` divides a
 * settlement value by this rate, so **both sides must share a unit**. When
 * IDR moved from Rupiah to sen, the rate had to move from 6 Rupiah-per-point
 * to 600 sen-per-point — and updating three of the four copies would have
 * left one surface pricing every voucher 100x wrong, with nothing failing,
 * because each copy is only ever compared against values that agree with it.
 *
 * A number that must change in four places at once is a number that will
 * eventually change in three.
 *
 * ## Not the pricing engine
 *
 * Illustrative only, like the rates it replaces. The real demand multiplier
 * and its 0.8–1.25 bounds live in the pricing service (docs/09 section 4.1),
 * and the actual backing rate is an economics decision nobody owns yet
 * (YT-0050). These exist so mock catalogues show plausible point prices.
 */

/**
 * Sen per point. 600 sen = Rp 6, the rate this was before YT-0506 settled
 * the minor unit — the same economics, restated in the unit we now store.
 */
export const MOCK_BACKING_RATE_IDR_SEN_PER_POINT = 600;

/** AUD cents per point. Unaffected by YT-0506: AUD was always two-decimal. */
export const MOCK_BACKING_RATE_AUD_CENTS_PER_POINT = 3;
