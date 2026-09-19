import type { Faker } from "@faker-js/faker";
import type { Region } from "../region/region";
import { LONG_MERCHANT_NAME } from "../internal/jakarta";
import { LONG_MERCHANT_NAME_AU } from "../internal/sydney";

/**
 * The fixed cast of merchants every mock in this package draws from.
 *
 * ## The bug this exists to make impossible
 *
 * A voucher's `merchantId` used to be `faker.string.uuid()` — a fresh random
 * UUID per voucher. The merchant portal provisions a counter device as one
 * of three fixed merchants. **The two sets were disjoint by construction**,
 * so every redemption in the prototype returned `wrong_merchant`: not an
 * unlucky fixture, a guaranteed one. Nobody could complete earn → spend →
 * redeem, which is the entire loop YT-0450's walkthrough exists to test.
 *
 * It was found by driving the journey in a browser. It could not be found by
 * reading either file, because neither is wrong on its own — the wrongness
 * is that they never agreed on who a merchant is.
 *
 * ## Why every entry is provisionable
 *
 * `provisioningCode` is required, not optional. A roster where some
 * merchants have counters and some do not would fix the reported bug and
 * leave the same hole open one size smaller: vouchers issued against a
 * counterless merchant would still be unredeemable, and the next person to
 * add a merchant would have no reason to think the code mattered.
 *
 * Making it required means a merchant with no way to redeem its own vouchers
 * **cannot be written down** — the bad state is unrepresentable rather than
 * validated (docs/13). `merchant-roster.test.ts` then holds the other
 * direction: no mock may invent a merchant that is not in here.
 *
 * ## Why the first three ids are not negotiable
 *
 * `…0601`, `…0602` and `…0603` are exactly the ids and names already hard
 * coded in `apps/web/features/merchant/provisioning/provisioning-data.ts`.
 * Matching them means the redeem loop works the moment this lands, with no
 * change needed in that file — which belongs to another session. That file
 * should eventually derive its `MOCK_PROVISIONING_CODES` from this roster so
 * the two can never diverge again; until it does, `merchant-roster.test.ts`
 * pins the three entries it depends on.
 *
 * ## One name, one id
 *
 * "Toko Berkah" previously existed twice — `…0303` in the listing fixtures
 * and `…0601` in provisioning — so a cashier could be shown
 * *"Voucher untuk Toko Berkah, bukan Toko Berkah"*: identical names,
 * different ids, and an error message that reads as a bug in the error
 * message. Names are unique here, and tested to be.
 */
export interface MockMerchant {
  readonly id: string;
  readonly name: string;
  readonly region: Region;
  /** The code that provisions a counter device as this merchant. */
  readonly provisioningCode: string;
  /** How that device names itself on screen. */
  readonly counterLabel: string;
}

export const MOCK_MERCHANTS: readonly MockMerchant[] = [
  {
    id: "00000000-0000-4000-8000-000000000601",
    name: "Toko Berkah",
    region: "ID",
    provisioningCode: "TOKO-BERKAH-1",
    counterLabel: "Toko Berkah — Kasir 1",
  },
  {
    id: "00000000-0000-4000-8000-000000000602",
    name: "Kopi Kenangan Kemang",
    region: "ID",
    provisioningCode: "KEMANG-COUNTER-2",
    counterLabel: "Kemang counter 2",
  },
  {
    id: "00000000-0000-4000-8000-000000000603",
    name: "Sydney CBD Cafe",
    region: "AU",
    provisioningCode: "SYDNEY-CBD-1",
    counterLabel: "Sydney CBD — Register 1",
  },
  {
    id: "00000000-0000-4000-8000-000000000604",
    name: "Kopi Sentosa",
    region: "ID",
    provisioningCode: "SENTOSA-1",
    counterLabel: "Kopi Sentosa — Kasir 1",
  },
  {
    id: "00000000-0000-4000-8000-000000000605",
    name: "Warung Nusantara Jaya",
    region: "ID",
    provisioningCode: "NUSANTARA-1",
    counterLabel: "Warung Nusantara Jaya — Kasir 1",
  },
  {
    // The 78-character layout breaker. Kept in the roster rather than as a
    // one-off fixture so that a long name is reachable through the ordinary
    // generators too — a name that only appears in a hand-written fixture
    // only breaks layouts somebody thought to test.
    id: "00000000-0000-4000-8000-000000000606",
    name: LONG_MERCHANT_NAME,
    region: "ID",
    provisioningCode: "LONGNAME-ID-1",
    counterLabel: "Kasir 1",
  },
  {
    id: "00000000-0000-4000-8000-0000000006a1",
    name: "Wharf Espresso Co",
    region: "AU",
    provisioningCode: "WHARF-1",
    counterLabel: "Wharf Espresso — Register 1",
  },
  {
    id: "00000000-0000-4000-8000-0000000006a3",
    name: "Cedar Deli Bar",
    region: "AU",
    provisioningCode: "CEDAR-1",
    counterLabel: "Cedar Deli Bar — Register 1",
  },
  {
    id: "00000000-0000-4000-8000-0000000006a2",
    name: LONG_MERCHANT_NAME_AU,
    region: "AU",
    provisioningCode: "LONGNAME-AU-1",
    counterLabel: "Register 1",
  },
];

const BY_ID = new Map(MOCK_MERCHANTS.map((merchant) => [merchant.id, merchant]));

export function mockMerchantById(id: string): MockMerchant | undefined {
  return BY_ID.get(id);
}

export function mockMerchantsInRegion(region: Region): readonly MockMerchant[] {
  return MOCK_MERCHANTS.filter((merchant) => merchant.region === region);
}

/**
 * Picks a merchant for a generated fixture, deterministically from the
 * caller's seeded faker.
 *
 * Draws exactly one value from `faker` regardless of region, so adding a
 * merchant to the roster does not shift the draw order for anything
 * downstream — see `seed.ts` on why a shifted draw order silently
 * reseeds every id in the catalogue.
 */
export function pickMockMerchant(faker: Faker, region: Region): MockMerchant {
  const candidates = mockMerchantsInRegion(region);
  const chosen = candidates[faker.number.int({ min: 0, max: candidates.length - 1 })];
  if (chosen === undefined) {
    throw new Error(`No mock merchants are registered for region ${region}`);
  }
  return chosen;
}
