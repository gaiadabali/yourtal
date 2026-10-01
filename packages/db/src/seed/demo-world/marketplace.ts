import { DemoApi, field, ok } from "./api-client";
import { DEMO_BRANDS } from "./catalogue";
import type { Region } from "./catalogue";
import { businessIdFor, campaignIdFor, listingIdFor } from "./world";

/**
 * 13.1 (F86): the user-to-user screens get data after a reset, all through
 * the real routes: approved charities (apply, then a staff decision), demo
 * vouchers bought with goodwill points, pending and accepted gifts, open
 * charity auctions with bids, and one boosted campaign. Teens take no part.
 */
export interface MarketplaceConfig {
  readonly apiBaseUrl: string;
  readonly password: string;
}

const email = (local: string, region: Region): string =>
  `${local}.${region.toLowerCase()}@demo.yourtal.test`;

const ids = new WeakMap<DemoApi, string>();

async function login(base: DemoApi, address: string, password: string): Promise<DemoApi> {
  const body = ok(
    await base.post("/api/auth/login", { email: address, password }),
    `login ${address}`,
  );
  const api = base.withSession(String(field(body, "token")));
  ids.set(api, String(field(body, "userId")));
  return api;
}

const CHARITIES: Readonly<
  Record<Region, readonly { local: string; name: string; cause: string; summary: string }[]>
> = {
  AU: [
    {
      local: "charity1",
      name: "Coastal Kids Trust",
      cause: "children_youth",
      summary: "Free swimming and surf-safety lessons for kids in coastal towns.",
    },
    {
      local: "charity2",
      name: "Green Corridors Fund",
      cause: "environment",
      summary: "Replanting native bushland corridors so wildlife can move between parks.",
    },
  ],
  ID: [
    {
      local: "charity1",
      name: "Yayasan Anak Pesisir",
      cause: "children_youth",
      summary: "Kelas berenang dan keselamatan pantai gratis untuk anak-anak pesisir.",
    },
    {
      local: "charity2",
      name: "Yayasan Hutan Kota",
      cause: "environment",
      summary: "Menanam kembali hutan kota agar satwa bisa berpindah antartaman.",
    },
  ],
};

/** Applies with each demo charity login and approves it as staff, unless it is already approved. */
async function ensureCharities(
  base: DemoApi,
  admin: DemoApi,
  region: Region,
  password: string,
): Promise<string[]> {
  const listed = (field(
    ok(await base.get(`/api/charities?region=${region}`), "charities"),
    "charities",
  ) ?? []) as {
    id: string;
    name: string;
  }[];
  const ids: string[] = [];
  for (const [index, charity] of CHARITIES[region].entries()) {
    const existing = listed.find((c) => c.name === charity.name);
    if (existing !== undefined) {
      ids.push(existing.id);
      continue;
    }
    const applicant = await login(base, email(charity.local, region), password);
    const registration =
      region === "AU"
        ? { kind: "au_acnc", abn: `5182475355${String(index)}`, acncRegistered: true }
        : {
            kind: "id_yayasan",
            deedNumber: `AHU-00${String(index + 1)}.AH.01.04`,
            fundraisingPermitNumber: `PUB-${String(index + 1)}/2026`,
          };
    const applied = ok(
      await applicant.post("/api/charities/applications", {
        name: charity.name,
        region,
        cause: charity.cause,
        summary: charity.summary,
        registration,
        payoutAccount: {
          accountName: charity.name,
          bankCode: region === "AU" ? "062000" : "014",
          accountNumber: `1000200${String(index)}`,
        },
      }),
      `apply ${charity.name}`,
    );
    const charityId = String(field(applied, "id") ?? field(applied, "charity", "id"));
    ok(
      await admin.post(`/api/staff/charities/${charityId}/decision`, {
        decision: "approve",
        reason: "Demo charity: registration and payout account checked.",
      }),
      `approve ${charity.name}`,
    );
    ids.push(charityId);
  }
  return ids;
}

interface WalletVoucher {
  readonly voucherId: string;
  readonly status?: string;
}

async function activeVouchers(viewer: DemoApi): Promise<string[]> {
  const body = ok(await viewer.get("/api/wallet/vouchers"), "wallet vouchers");
  return ((field(body, "vouchers") ?? []) as WalletVoucher[])
    .filter((v) => v.status === "active")
    .map((v) => v.voucherId);
}

/** Support credits goodwill points (under the per-case limit), the viewer releases and buys. */
async function stockWallet(
  admin: DemoApi,
  viewer: DemoApi,
  userId: string,
  region: Region,
  want: number,
): Promise<void> {
  const perCase = region === "AU" ? 500 : 5_000;
  for (let i = 0; i < 4; i += 1) {
    ok(
      await admin.post(`/api/staff/users/${userId}/goodwill`, {
        points: perCase,
        reason: "Demo world starting balance",
      }),
      "goodwill",
    );
  }
  ok(await viewer.post("/api/dev/clock/release-pending"), "release pending");
  const listings = DEMO_BRANDS.filter((b) => b.region === region).flatMap((brand) =>
    brand.listings
      .filter((l) => l.audience === "all_ages" || l.audience === "adult")
      .map((l) => listingIdFor(brand.slug, l.key)),
  );
  let bought = 0;
  for (const listingId of listings) {
    if (bought >= want) break;
    const quote = await viewer.post("/api/checkout/quote", { listingId });
    if (quote.status >= 400) continue;
    const done = await viewer.post("/api/checkout", {
      checkoutId: field(quote.body, "checkoutId"),
    });
    if (done.status < 400) bought += 1;
  }
}

function userIdOf(api: DemoApi): string {
  const id = ids.get(api);
  if (id === undefined) throw new Error("not a logged-in demo api");
  return id;
}

export async function runDemoMarketplace(
  config: MarketplaceConfig,
  log: (message: string) => void,
): Promise<void> {
  const base = new DemoApi(config.apiBaseUrl);
  const admin = await login(base, "admin@demo.yourtal.test", config.password);
  for (const region of ["AU", "ID"] as const) {
    const charities = await ensureCharities(base, admin, region, config.password);
    log(`[demo:marketplace] ${region}: ${String(charities.length)} approved charities`);

    const adult = await login(base, email("adult", region), config.password);
    const guardian = await login(base, email("guardian", region), config.password);
    const viewer = await login(base, email("viewer", region), config.password);
    await stockWallet(admin, adult, userIdOf(adult), region, 4);
    await stockWallet(admin, guardian, userIdOf(guardian), region, 2);

    // Gifts: one accepted, one left pending.
    const [toAccept, toLeave, toAuction] = await activeVouchers(adult);
    if (toAccept !== undefined) {
      const sent = ok(
        await adult.post(`/api/wallet/vouchers/${toAccept}/gift`, {
          recipientEmail: email("guardian", region),
        }),
        "gift",
      );
      ok(
        await guardian.post(`/api/wallet/gifts/${String(field(sent, "giftId"))}/accept`),
        "accept gift",
      );
    }
    if (toLeave !== undefined) {
      ok(
        await adult.post(`/api/wallet/vouchers/${toLeave}/gift`, {
          recipientEmail: email("viewer", region),
        }),
        "pending gift",
      );
    }

    // Auctions: each adult lists one voucher for a charity, the others bid.
    const listings: { seller: DemoApi; voucherId: string; charityId: string }[] = [];
    const guardianVoucher = (await activeVouchers(guardian))[0];
    if (toAuction !== undefined && charities[0] !== undefined)
      listings.push({ seller: adult, voucherId: toAuction, charityId: charities[0] });
    if (guardianVoucher !== undefined && charities[1] !== undefined)
      listings.push({ seller: guardian, voucherId: guardianVoucher, charityId: charities[1] });
    for (const listing of listings) {
      const auction = ok(
        await listing.seller.post(`/api/wallet/vouchers/${listing.voucherId}/auction`, {
          charityId: listing.charityId,
        }),
        "list auction",
      );
      const auctionId = String(field(auction, "auctionId"));
      for (const bidder of [adult, guardian, viewer].filter((b) => b !== listing.seller)) {
        const view = ok(await bidder.get(`/api/auctions/${auctionId}`), "auction");
        const next = Number(field(view, "minimumNextBidMinor"));
        await bidder.post(`/api/auctions/${auctionId}/bids`, { amountMinor: next });
      }
    }

    // Boost: the owner bids on one long demo campaign for the next fortnight.
    const brand = DEMO_BRANDS.find(
      (b) => b.region === region && b.campaigns.some((c) => c.seconds > 60),
    );
    const campaign = brand?.campaigns.find((c) => c.seconds > 60);
    if (brand !== undefined && campaign !== undefined) {
      const owner = await login(base, email("owner", region), config.password);
      const now = Date.now();
      ok(
        await owner.put(
          `/api/${businessIdFor(brand.slug)}/studio/campaigns/${campaignIdFor(brand.slug, campaign.key)}/boost`,
          {
            dailyBudgetMinor: region === "AU" ? 2_000 : 100_000,
            maxBidCpmMinor: region === "AU" ? 300 : 15_000,
            startsAt: new Date(now).toISOString(),
            endsAt: new Date(now + 14 * 86_400_000).toISOString(),
          },
        ),
        "boost",
      );
    }
    log(`[demo:marketplace] ${region}: gifts, ${String(listings.length)} auctions and a boost`);
  }
}
