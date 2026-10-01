import { DemoApi, field, loginAs, ok } from "./api-client";
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
  const { api, userId } = await loginAs(base, address, password);
  ids.set(api, userId);
  return api;
}

// Checksum-valid ABNs (the simulated KYB checks them, like the real ABR).
const DEMO_ABNS = ["51824753524", "51824753556"];

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
        ? { kind: "au_acnc", abn: DEMO_ABNS[index] ?? DEMO_ABNS[0], acncRegistered: true }
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

/**
 * Support credits one goodwill case, the viewer releases it and buys the cheapest
 * adult-visible voucher.
 */
async function buyOneVoucher(admin: DemoApi, viewer: DemoApi, region: Region): Promise<void> {
  // Enough for the cheapest voucher, leaving room under the daily earn cap to watch.
  const points = region === "AU" ? 300 : 3_000;
  const credited = await admin.post(`/api/staff/users/${userIdOf(viewer)}/goodwill`, {
    points,
    reason: "Demo world starting balance",
  });
  // Already credited today (a re-run): spend what is there.
  if (credited.status >= 400 && !JSON.stringify(credited.body).includes("velocity_capped")) {
    ok(credited, "goodwill");
  }
  ok(await viewer.post("/api/dev/clock/release-pending"), "release pending");
  const balance = Number(
    field(ok(await viewer.get("/api/wallet"), "wallet"), "availablePoints") ?? 0,
  );
  const listings = DEMO_BRANDS.filter((b) => b.region === region).flatMap((brand) =>
    brand.listings
      .filter((l) => l.audience === "all_ages" || l.audience === "adult")
      .map((l) => ({ id: listingIdFor(brand.slug, l.key), face: l.faceValueMinor })),
  );
  for (const listing of listings.sort((a, b) => a.face - b.face)) {
    const quote = await viewer.post("/api/checkout/quote", { listingId: listing.id });
    if (quote.status >= 400 || Number(field(quote.body, "pricePoints")) > balance) continue;
    // A sold-out listing moves on to the next one.
    const bought = await viewer.post("/api/checkout", {
      checkoutId: field(quote.body, "checkoutId"),
    });
    if (bought.status < 400) return;
  }
  // Only after a same-day re-run on the same accounts; the steps below skip a missing voucher.
  console.log("[demo:marketplace] no demo voucher was affordable");
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

    const [adult, guardian, viewer, member] = await Promise.all(
      ["adult", "guardian", "viewer", "member"].map((who) =>
        login(base, email(who, region), config.password),
      ),
    );
    if (!adult || !guardian || !viewer || !member) throw new Error("demo logins missing");
    for (const person of [adult, guardian, viewer, member])
      await buyOneVoucher(admin, person, region);
    const first = async (api: DemoApi) => (await activeVouchers(api))[0];

    // Gifts: the adult's is accepted by the guardian; the viewer's waits for the adult.
    const adultVoucher = await first(adult);
    const guardianVoucher = await first(guardian);
    const memberVoucher = await first(member);
    const viewerVoucher = await first(viewer);
    if (adultVoucher !== undefined) {
      const sent = ok(
        await adult.post(`/api/wallet/vouchers/${adultVoucher}/gift`, {
          recipientEmail: email("guardian", region),
        }),
        "gift",
      );
      ok(
        await guardian.post(`/api/wallet/gifts/${String(field(sent, "giftId"))}/accept`),
        "accept gift",
      );
    }
    if (viewerVoucher !== undefined) {
      ok(
        await viewer.post(`/api/wallet/vouchers/${viewerVoucher}/gift`, {
          recipientEmail: email("adult", region),
        }),
        "pending gift",
      );
    }

    // Charity auctions, listed by the guardian and the marketer, with bids from the others.
    const listings = [
      {
        seller: guardian,
        voucherId: guardianVoucher,
        charityId: charities[0],
        bidders: [adult, viewer],
      },
      {
        seller: member,
        voucherId: memberVoucher,
        charityId: charities[1],
        bidders: [adult, guardian],
      },
    ];
    let auctions = 0;
    for (const listing of listings) {
      if (listing.voucherId === undefined || listing.charityId === undefined) continue;
      const auction = ok(
        await listing.seller.post(`/api/wallet/vouchers/${listing.voucherId}/auction`, {
          charityId: listing.charityId,
        }),
        "list auction",
      );
      const auctionId = String(field(auction, "auctionId"));
      for (const bidder of listing.bidders) {
        const view = ok(await bidder.get(`/api/auctions/${auctionId}`), "auction");
        ok(
          await bidder.post(`/api/auctions/${auctionId}/bids`, {
            amountMinor: Number(field(view, "minimumNextBidMinor")),
          }),
          "bid",
        );
      }
      auctions += 1;
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
    log(`[demo:marketplace] ${region}: 2 gifts, ${String(auctions)} auctions and a boost`);
  }
}
