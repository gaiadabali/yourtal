import type pg from "pg";
import { DemoApi, field, loginAs, ok, sleep } from "./api-client";
import type { DemoPasswords } from "./api-client";
import { DEMO_BRANDS } from "./catalogue";
import type { Audience } from "@yourtal/contracts/audience/audience";
import type { Region } from "./catalogue";
import { businessIdFor, campaignIdFor, listingIdFor } from "./world";

/**
 * 13.1.b: one day of history, made by the demo accounts through the real api:
 * they watch, answer, earn, release, buy and redeem at a counter. Run once by
 * `demo:reset` and then daily on staging, so a week of it is a real week.
 * It reads the database only for answer keys, which no api hands out.
 */
export interface DemoActivityConfig extends DemoPasswords {
  readonly apiBaseUrl: string;
}

const TICK_MS = 3_000;
const DEVICE_PIN = "2468";

interface Viewer {
  readonly email: string;
  readonly region: Region;
  readonly sees: readonly Audience[];
  readonly releases: boolean;
}

function viewers(region: Region): Viewer[] {
  const r = region.toLowerCase();
  return [
    { email: `adult.${r}@demo.yourtal.test`, region, sees: ["all_ages", "adult"], releases: true },
    { email: `teen.${r}@demo.yourtal.test`, region, sees: ["teen", "all_ages"], releases: true },
    {
      email: `guardian.${r}@demo.yourtal.test`,
      region,
      sees: ["parents", "all_ages"],
      releases: true,
    },
    // The tier-0 viewer keeps its points pending, so the wallet shows both states.
    { email: `viewer.${r}@demo.yourtal.test`, region, sees: ["all_ages"], releases: false },
  ];
}

/** Two short campaigns a viewer may watch today, rotating through the catalogue by date. */
function todaysCampaigns(viewer: Viewer, day: number): string[] {
  const eligible = DEMO_BRANDS.filter((b) => b.region === viewer.region).flatMap((brand) =>
    brand.campaigns
      .filter((c) => c.seconds <= 90 && viewer.sees.includes(c.audience))
      .map((c) => campaignIdFor(brand.slug, c.key)),
  );
  if (eligible.length === 0) return [];
  return [eligible[day % eligible.length], eligible[(day + 1) % eligible.length]].filter(
    (id, index, all): id is string => id !== undefined && all.indexOf(id) === index,
  );
}

async function login(api: DemoApi, email: string, passwords: DemoPasswords): Promise<DemoApi> {
  return (await loginAs(api, email, passwords)).api;
}

/** Watches one campaign in real time, answering each checkpoint (most of them right). */
export async function watch(pool: pg.Pool, api: DemoApi, campaignId: string): Promise<string> {
  const started = await api.post("/api/watch/sessions", { campaignId });
  if (started.status >= 400) return `refused ${String(started.status)}`;
  if (field(started.body, "alreadyEarned") === true) return "already earned";
  const sessionId = String(field(started.body, "session", "id"));
  const duration = Number(field(started.body, "durationSeconds"));
  const t0 = Date.now();
  let covered = 0;
  let checkpoint = 0;
  let questionsDone = false;
  let lastCheckpoint = "";
  while (covered < duration || !questionsDone) {
    await sleep(TICK_MS);
    const to = Math.min(duration, Math.floor((Date.now() - t0) / 1000));
    const progress = await api.post(`/api/watch/sessions/${sessionId}/progress`, {
      fromSeconds: covered,
      toSeconds: to,
      reportedAt: new Date().toISOString(),
    });
    covered = Number(field(progress.body, "coveredSeconds") ?? covered);
    if (!questionsDone) {
      const presented = await api.post(
        `/api/watch/sessions/${sessionId}/checkpoints/${String(checkpoint)}`,
      );
      if (presented.status === 404) questionsDone = true;
      lastCheckpoint = `${String(presented.status)} ${JSON.stringify(presented.body).slice(0, 120)}`;
      if (presented.status === 200 || presented.status === 201) {
        const questionId = String(field(presented.body, "question", "id"));
        const key = await pool.query<{ correct_option_id: string }>(
          "SELECT correct_option_id FROM campaign.question_answer_key WHERE question_id = $1",
          [questionId],
        );
        const options = (field(presented.body, "question", "options") ?? []) as { id: string }[];
        const right = key.rows[0]?.correct_option_id;
        // One answer in five is wrong, so reports show a real accuracy spread.
        const pick = Math.random() < 0.8 ? right : options.find((o) => o.id !== right)?.id;
        const answered = await api.post(
          `/api/watch/sessions/${sessionId}/checkpoints/${String(checkpoint)}/answer`,
          {
            token: field(presented.body, "token"),
            selectedOptionId: pick,
          },
        );
        if (answered.status >= 400) {
          return `answer ${String(answered.status)} ${JSON.stringify(answered.body).slice(0, 160)}`;
        }
        checkpoint += 1;
      }
    }
    if (Date.now() - t0 > (duration + 120) * 1000) {
      return `timed out at ${String(covered)} s; last checkpoint: ${lastCheckpoint}`;
    }
  }
  const done = await api.post(`/api/watch/sessions/${sessionId}/complete`);
  if (done.status >= 400)
    return `complete ${String(done.status)} ${JSON.stringify(done.body).slice(0, 160)}`;
  return field(done.body, "granted") === true
    ? `earned ${JSON.stringify(field(done.body, "pendingPoints") ?? null)}`
    : `not granted: ${String(field(done.body, "reason"))}`;
}

/** The cheapest demo listing this viewer may buy, if the balance covers it. */
async function buyOne(api: DemoApi, viewer: Viewer): Promise<string | null> {
  const balance = Number(field(ok(await api.get("/api/wallet"), "wallet"), "availablePoints") ?? 0);
  const candidates = DEMO_BRANDS.filter((b) => b.region === viewer.region).flatMap((brand) =>
    brand.listings
      .filter((l) => viewer.sees.includes(l.audience))
      .map((l) => listingIdFor(brand.slug, l.key)),
  );
  for (const listingId of candidates) {
    const quote = await api.post("/api/checkout/quote", { listingId });
    if (quote.status >= 400) continue;
    if (Number(field(quote.body, "pricePoints") ?? Infinity) > balance) continue;
    const bought = await api.post("/api/checkout", { checkoutId: field(quote.body, "checkoutId") });
    if (bought.status < 400) return listingId;
  }
  return null;
}

/** Unused vouchers a member must keep so a gift and a charity listing are always possible: one past the holdback, one fresh. */
export const KEEP_GIFTABLE = 2;

/**
 * The one voucher to redeem today. A voucher this member cannot pass on (won at
 * an auction, or received) is the one to spend; a giftable one is spent only
 * when more than `KEEP_GIFTABLE` would stay.
 */
export function pickToRedeem<T extends { status?: string; giftable?: boolean }>(
  vouchers: readonly T[],
): T[] {
  const active = vouchers.filter((v) => v.status === "active");
  const spendable = active.find((v) => v.giftable !== true);
  if (spendable !== undefined) return [spendable];
  const giftable = active.filter((v) => v.giftable === true);
  return giftable.length > KEEP_GIFTABLE ? giftable.slice(0, 1) : [];
}

/** The voucher to put up for a charity: a giftable one, only while more than KEEP_GIFTABLE remain. */
export function pickToAuction<T extends { status?: string; giftable?: boolean }>(
  vouchers: readonly T[],
): T | undefined {
  // Same keep rule as pickToRedeem: the guide's gift and auction journeys need KEEP_GIFTABLE left.
  const giftable = vouchers.filter((v) => v.status === "active" && v.giftable === true);
  return giftable.length > KEEP_GIFTABLE ? giftable[0] : undefined;
}

/**
 * The seeded auctions run 72 hours and nothing else opens one, so the auctions page would go
 * empty. When none is open in the region, the member lists one voucher for an approved charity.
 * Demo data only: this runs from the demo activity job, which is off in production.
 * ponytail: no bids placed here (a bid needs a saved card on AU); an auction without bids is still open.
 */
async function keepAuctionOpen(seller: DemoApi, region: Region): Promise<string> {
  const open = (field(ok(await seller.get("/api/auctions"), "auctions"), "auctions") ??
    []) as unknown[];
  if (open.length > 0) return `${region} auctions open: ${String(open.length)}`;
  const charities = (field(
    ok(await seller.get(`/api/charities?region=${region}`), "charities"),
    "charities",
  ) ?? []) as { id: string }[];
  const vouchers = (field(ok(await seller.get("/api/wallet/vouchers"), "vouchers"), "vouchers") ??
    []) as { voucherId: string; status?: string; giftable?: boolean }[];
  const voucher = pickToAuction(vouchers);
  if (voucher === undefined || charities.length === 0)
    return `${region} no auction opened: nothing to list`;
  // The first charity may not have finished payment onboarding (AU): try the next.
  let code = "";
  for (const charity of charities) {
    const listed = await seller.post(`/api/wallet/vouchers/${voucher.voucherId}/auction`, {
      charityId: charity.id,
    });
    if (listed.status < 400) return `${region} opened an auction`;
    code = String(field(listed.body, "code"));
    if (code !== "charity_not_ready") break;
  }
  return `${region} no auction opened: ${code}`;
}

/** The owner pairs a till at the brand and redeems every unused demo voucher bought there. */
async function redeemAtCounter(
  pool: pg.Pool,
  owner: DemoApi,
  base: DemoApi,
  buyer: DemoApi,
  region: Region,
): Promise<number> {
  const vouchers = (field(ok(await buyer.get("/api/wallet/vouchers"), "vouchers"), "vouchers") ??
    []) as { voucherId: string; status?: string; giftable?: boolean }[];
  let redeemed = 0;
  // One a day, and never the last unused ones: the guide's gift and charity-auction
  // journeys need vouchers this account may still pass on.
  for (const voucher of pickToRedeem(vouchers)) {
    const row = await pool.query<{ merchant_id: string; location_id: string }>(
      "SELECT merchant_id::text, location_id::text FROM voucher.vouchers WHERE id = $1",
      [voucher.voucherId],
    );
    const facts = row.rows[0];
    if (
      facts === undefined ||
      !DEMO_BRANDS.some((b) => b.region === region && businessIdFor(b.slug) === facts.merchant_id)
    )
      continue;
    // The counter scans the wallet's QR token.
    const qr = ok(await buyer.get(`/api/wallet/vouchers/${voucher.voucherId}/qr`), "voucher qr");
    const code = String(field(qr, "token"));
    const provisioned = await owner.post(`/api/${facts.merchant_id}/studio/devices`, {
      locationId: facts.location_id,
      label: region === "AU" ? "Front counter" : "Kasir depan",
      pin: DEVICE_PIN,
    });
    const pairingCode = field(ok(provisioned, "provision device"), "pairingCode");
    const paired = ok(await base.post("/api/devices/pair", { pairingCode }), "pair device");
    const till = base.withDevice(
      String(field(paired, "deviceId")),
      String(field(paired, "credential")),
    );
    ok(await till.post("/api/devices/unlock", { pin: DEVICE_PIN }), "unlock device");
    const preview = ok(await till.post("/api/counter/lookup", { code }), "counter lookup");
    const authorized = ok(
      await till.post("/api/counter/authorize", {
        code,
        currency: field(preview, "currency"),
        orderRef: `DEMO-${voucher.voucherId.slice(0, 8)}`,
        orderTotalMinor: field(preview, "remainingValueMinor"),
      }),
      "counter authorize",
    );
    ok(
      await till.post("/api/counter/capture", {
        authorizationId: field(authorized, "authorizationId"),
      }),
      "counter capture",
    );
    redeemed += 1;
  }
  return redeemed;
}

export async function runDemoActivity(
  pool: pg.Pool,
  config: DemoActivityConfig,
  log: (message: string) => void,
): Promise<string> {
  const base = new DemoApi(config.apiBaseUrl);
  const day = Math.floor(Date.now() / 86_400_000);
  const lines: string[] = [];
  for (const region of ["AU", "ID"] as const) {
    const people = await Promise.all(
      viewers(region).map(async (v) => ({ v, api: await login(base, v.email, config) })),
    );
    // Everyone watches at once, in real time.
    await Promise.all(
      people.map(async ({ v, api }) => {
        for (const campaignId of todaysCampaigns(v, day)) {
          const outcome = await watch(pool, api, campaignId).catch((e: unknown) => String(e));
          lines.push(`${v.email} ${campaignId.slice(0, 8)}: ${outcome}`);
        }
        if (v.releases) await api.post("/api/dev/clock/release-pending");
      }),
    );
    const adult = people.find((p) => p.v.email.startsWith("adult."));
    if (adult !== undefined) {
      const bought = await buyOne(adult.api, adult.v);
      lines.push(`${adult.v.email} bought: ${bought ?? "nothing affordable"}`);
      const owner = await login(base, `owner.${region.toLowerCase()}@demo.yourtal.test`, config);
      const redeemed = await redeemAtCounter(pool, owner, base, adult.api, region).catch(
        (e: unknown) => {
          lines.push(`${region} counter: ${String(e)}`);
          return 0;
        },
      );
      lines.push(`${region} counter redeemed ${String(redeemed)}`);
      lines.push(await keepAuctionOpen(adult.api, region).catch((e: unknown) => String(e)));
    }
  }
  for (const line of lines) log(`[demo:activity] ${line}`);
  return `${String(lines.length)} steps`;
}
