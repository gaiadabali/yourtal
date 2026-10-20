import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signServiceRequest } from "@yourtal/contracts/ledger-internal/service-signature";
import { createWorkerLedgerClient } from "../ledger-client";
import {
  closedWeeks,
  liveStatementLedger,
  runSettlementStatements,
  WEEKS_BACK,
} from "./settlement-statements";
import { createFakeStatementLedger } from "./settlement-statements-fake";

/** 5.2.d against real Postgres (the fake ledger's tables) and a signed HTTP stub (the live ledger). */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
const pool = new Pool({ connectionString: DATABASE_URL });

// Wednesday 21 October 2026, 03:00 UTC: Sydney (daylight time, +11) is Wednesday 14:00 and
// Jakarta (+7) 10:00, so both regions are in the week that began Monday 19 October.
const NOW = new Date("2026-10-21T03:00:00Z");

describe("closedWeeks", () => {
  it("is Monday 00:00 to Monday 00:00 on the region's own clock", () => {
    const au = closedWeeks("AU", NOW, 2);
    expect(au).toEqual([
      { from: "2026-10-04T13:00:00.000Z", to: "2026-10-11T13:00:00.000Z" },
      { from: "2026-10-11T13:00:00.000Z", to: "2026-10-18T13:00:00.000Z" },
    ]);
    expect(closedWeeks("ID", NOW, 2)).toEqual([
      { from: "2026-10-04T17:00:00.000Z", to: "2026-10-11T17:00:00.000Z" },
      { from: "2026-10-11T17:00:00.000Z", to: "2026-10-18T17:00:00.000Z" },
    ]);
  });

  it("takes the last six closed weeks, oldest first, with no gap or overlap", () => {
    for (const region of ["AU", "ID"] as const) {
      const weeks = closedWeeks(region, NOW);
      expect(weeks).toHaveLength(WEEKS_BACK);
      weeks.slice(1).forEach((week, index) => {
        expect(week.from).toBe(weeks[index]?.to);
      });
    }
  });

  it("a daylight-saving week is as long as the clock says, not 168 hours", () => {
    const [week] = closedWeeks("AU", new Date("2026-04-14T00:00:00Z"), 2);
    // Sydney left daylight time on Sunday 5 April 2026: Monday 30 March to Monday 6 April is 169 hours.
    expect(week).toEqual({ from: "2026-03-29T13:00:00.000Z", to: "2026-04-05T14:00:00.000Z" });
  });

  it("a week closes at each region's own Monday, plus an hour for late commits", () => {
    const lastClosedEnd = (region: "AU" | "ID", at: string) =>
      closedWeeks(region, new Date(at), 1)[0]?.to;
    // Sydney's Monday 19 October 00:00 is 13:00Z on the 18th; Jakarta's is 17:00Z.
    expect(lastClosedEnd("AU", "2026-10-18T13:59:59Z")).toBe("2026-10-11T13:00:00.000Z");
    expect(lastClosedEnd("AU", "2026-10-18T14:00:00Z")).toBe("2026-10-18T13:00:00.000Z");
    // The same instant is still Sunday evening in Jakarta.
    expect(lastClosedEnd("ID", "2026-10-18T14:00:00Z")).toBe("2026-10-11T17:00:00.000Z");
    expect(lastClosedEnd("ID", "2026-10-18T17:59:59Z")).toBe("2026-10-11T17:00:00.000Z");
    expect(lastClosedEnd("ID", "2026-10-18T18:00:00Z")).toBe("2026-10-18T17:00:00.000Z");
  });
});

const created = { merchants: [] as string[] };

afterAll(async () => {
  for (const merchant of created.merchants) {
    await pool.query(`DELETE FROM platform.ledger_fake_statement WHERE business_id = $1`, [
      merchant,
    ]);
    await pool.query(`DELETE FROM platform.ledger_fake_capture_recovery WHERE merchant_id = $1`, [
      merchant,
    ]);
    await pool.query(`DELETE FROM platform.ledger_fake_capture WHERE merchant_id = $1`, [merchant]);
  }
  await pool.end();
});

async function capture(
  merchant: string,
  region: "AU" | "ID",
  amountMinor: number,
  postedAt: string,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO platform.ledger_fake_capture
       (capture_id, region, merchant_id, amount_minor, currency, transfer_id, posted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
    [id, region, merchant, amountMinor, region === "AU" ? "AUD" : "IDR", `xfer_${id}`, postedAt],
  );
  return id;
}

function merchant(): string {
  const id = randomUUID();
  created.merchants.push(id);
  return id;
}

interface Stated {
  readonly period_from: string;
  readonly period_to: string;
  readonly opening: string;
  readonly captures: string;
  readonly closing: string;
  readonly region: string;
  readonly window_ends: string;
}

async function statementsOf(business: string): Promise<Stated[]> {
  const { rows } = await pool.query<Stated>(
    `SELECT to_char(period_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') AS period_from,
            to_char(period_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') AS period_to,
            opening_payable_minor::text AS opening, captures_minor::text AS captures,
            closing_payable_minor::text AS closing, region,
            to_char(dispute_window_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') AS window_ends
       FROM platform.ledger_fake_statement WHERE business_id = $1 ORDER BY period_from`,
    [business],
  );
  return rows;
}

describe("the weekly statement job on the fake ledger", () => {
  const ledger = createFakeStatementLedger(pool);
  const run = (now: Date = NOW) => runSettlementStatements(ledger, () => now);

  it("generates one statement per business per closed week it was active, none for the open week", async () => {
    const a = merchant();
    const quiet = merchant();
    await capture(a, "AU", 1_000, "2026-10-14T01:00:00Z"); // Sydney week 12 to 19 October
    await capture(a, "AU", 400, "2026-10-15T01:00:00Z");
    await capture(a, "AU", 2_500, "2026-10-08T01:00:00Z"); // the week before
    await capture(a, "AU", 9_999, "2026-10-20T01:00:00Z"); // this week is still open
    await run();

    expect(await statementsOf(a)).toEqual([
      {
        period_from: "2026-10-04T13:00Z",
        period_to: "2026-10-11T13:00Z",
        opening: "0",
        captures: "2500",
        closing: "2500",
        region: "AU",
        // Seven days after the week ends (F12).
        window_ends: "2026-10-18T13:00Z",
      },
      {
        period_from: "2026-10-11T13:00Z",
        period_to: "2026-10-18T13:00Z",
        // The first week's 2500 is that statement's to pay, not this one's.
        opening: "0",
        captures: "1400",
        closing: "1400",
        region: "AU",
        window_ends: "2026-10-25T13:00Z",
      },
    ]);
    // A business with no payable account gets nothing.
    expect(await statementsOf(quiet)).toEqual([]);
  });

  it("is idempotent: a rerun, and a run an hour later, generate nothing", async () => {
    const a = merchant();
    await capture(a, "AU", 700, "2026-10-13T01:00:00Z");
    const first = await run(new Date("2026-10-21T03:00:00Z"));
    expect(first.generated).toBeGreaterThanOrEqual(1);
    const before = await statementsOf(a);
    expect(before).toHaveLength(1);
    expect(await run(new Date("2026-10-21T03:00:00Z"))).toMatchObject({ generated: 0, due: 0 });
    expect(await run(new Date("2026-10-21T04:20:00Z"))).toMatchObject({ generated: 0, due: 0 });
    expect(await statementsOf(a)).toEqual(before);
  });

  it("backfills the weeks a missed run left, in order, and never over a later statement", async () => {
    const a = merchant();
    // Active in each of the last six closed weeks, 7 September to 19 October 2026 (Sydney).
    const days = ["09-09", "09-16", "09-23", "09-30", "10-07", "10-14"];
    for (const [index, day] of days.entries()) {
      await capture(a, "AU", (index + 1) * 100, `2026-${day}T01:00:00Z`);
    }
    // The job last ran on 30 September, when only the first three of those weeks had closed.
    await run(new Date("2026-09-30T03:00:00Z"));
    const early = await statementsOf(a);
    expect(early.map((s) => s.closing)).toEqual(["100", "200", "300"]);
    expect(early.map((s) => s.period_from)).toEqual([
      "2026-09-06T14:00Z",
      "2026-09-13T14:00Z",
      "2026-09-20T14:00Z",
    ]);

    // Three weeks of runs missed: the next one fills each week since, each claiming only its own.
    await run();
    const all = await statementsOf(a);
    expect(all.map((s) => s.period_from)).toEqual([
      "2026-09-06T14:00Z",
      "2026-09-13T14:00Z",
      "2026-09-20T14:00Z",
      "2026-09-27T14:00Z",
      "2026-10-04T13:00Z",
      "2026-10-11T13:00Z",
    ]);
    expect(all.map((s) => s.opening)).toEqual(["0", "0", "0", "0", "0", "0"]);
    expect(all.map((s) => s.captures)).toEqual(["100", "200", "300", "400", "500", "600"]);
    expect(all.map((s) => s.closing)).toEqual(["100", "200", "300", "400", "500", "600"]);
    // Nothing is claimed twice: the statements add up to everything captured.
    expect(all.reduce((sum, s) => sum + Number(s.closing), 0)).toBe(2_100);
  });

  it("a balance from before the backfill window lands in the oldest week once", async () => {
    const a = merchant();
    await capture(a, "AU", 5_000, "2026-07-01T01:00:00Z");
    await capture(a, "AU", 300, "2026-10-14T01:00:00Z");
    await run();
    const all = await statementsOf(a);
    expect(all.map((s) => [s.period_from, s.opening, s.captures, s.closing])).toEqual([
      ["2026-09-06T14:00Z", "5000", "0", "5000"],
      ["2026-10-11T13:00Z", "0", "300", "300"],
    ]);
  });

  it("uses each region's own clock at the week boundary", async () => {
    // Sunday 18 October 14:30 UTC is Monday 01:30 in Sydney, so already the open week,
    // and Sunday 21:30 in Jakarta, so still the week that closed that night.
    const instant = "2026-10-18T14:30:00Z";
    const au = merchant();
    const id = merchant();
    await capture(au, "AU", 800, instant);
    await capture(id, "ID", 800_000, instant);
    await run();
    expect(await statementsOf(au)).toEqual([]);
    expect(
      (await statementsOf(id)).map((s) => [s.region, s.period_from, s.period_to, s.captures]),
    ).toEqual([["ID", "2026-10-11T17:00Z", "2026-10-18T17:00Z", "800000"]]);
    // Once Sydney's week has closed, the AU capture is stated too, over Sydney's week.
    await run(new Date("2026-10-26T03:00:00Z"));
    expect((await statementsOf(au)).map((s) => [s.period_from, s.period_to])).toEqual([
      ["2026-10-18T13:00Z", "2026-10-25T13:00Z"],
    ]);
  });

  it("a recovery is stated in its own week, against the capture it reverses", async () => {
    const a = merchant();
    const captureId = await capture(a, "AU", 900, "2026-10-13T01:00:00Z");
    await pool.query(
      `INSERT INTO platform.ledger_fake_capture_recovery
         (id, capture_id, region, merchant_id, amount_minor, currency, reason, transfer_id, created_at)
       VALUES ($1, $2, 'AU', $3, 900, 'AUD', 'K13', $4, '2026-10-20T01:00:00Z')`,
      [randomUUID(), captureId, a, randomUUID()],
    );
    await run(new Date("2026-10-28T03:00:00Z"));
    expect((await statementsOf(a)).map((s) => [s.period_from, s.captures, s.closing])).toEqual([
      ["2026-10-11T13:00Z", "900", "900"],
      ["2026-10-18T13:00Z", "0", "-900"],
    ]);
  });

  it("one business failing does not stop the others, and the run still fails", async () => {
    const failing = merchant();
    const fine = merchant();
    await capture(failing, "AU", 100, "2026-10-14T01:00:00Z");
    await capture(fine, "AU", 100, "2026-10-14T01:00:00Z");
    const flaky = {
      dueBusinesses: (...args: Parameters<typeof ledger.dueBusinesses>) =>
        ledger.dueBusinesses(...args),
      generate: async (business: string, ...rest: ["AU" | "ID", string, string]) => {
        if (business === failing) throw new Error("ledger answered 503");
        await ledger.generate(business, ...rest);
      },
    };
    await expect(runSettlementStatements(flaky, () => NOW)).rejects.toThrow(
      /could not be generated/,
    );
    expect(await statementsOf(fine)).toHaveLength(1);
    expect(await statementsOf(failing)).toEqual([]);
    // The next run, with the ledger back, finishes it.
    await run();
    expect(await statementsOf(failing)).toHaveLength(1);
  });
});

const SECRET = "test-only-ledger-service-secret-32b";

describe("the weekly statement job on the live ledger's routes", () => {
  const calls: { path: string; caller: string; body: Record<string, string> }[] = [];
  let server: Server;
  let baseUrl = "";

  async function answer(req: IncomingMessage): Promise<[number, unknown]> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const header = String(req.headers["x-yourtal-service-signature"] ?? "");
    const fields = Object.fromEntries(header.split(",").map((part) => part.split("=")));
    const expected = signServiceRequest({
      secret: SECRET,
      caller: "worker",
      method: req.method ?? "",
      pathAndQuery: req.url ?? "",
      body: raw,
      unixSeconds: Number(fields["t"]),
      nonce: String(fields["n"]),
    });
    if (header !== expected) return [401, {}];
    const body = JSON.parse(raw) as Record<string, string>;
    calls.push({ path: req.url ?? "", caller: String(fields["c"]), body });
    if (req.url === "/v1/economy/statements/due") {
      // Only the 12 October week has a business due.
      return [
        200,
        {
          businessIds:
            body["from"] === "2026-10-11T13:00:00.000Z" && body["region"] === "AU"
              ? [BUSINESS]
              : [],
        },
      ];
    }
    return [
      200,
      {
        id: "stmt_1",
        businessId: body["businessId"],
        region: body["region"],
        currency: "AUD",
        periodFrom: body["from"],
        periodTo: body["to"],
        openingPayableMinor: 0,
        capturesMinor: 100,
        refundsMinor: 0,
        recoveriesMinor: 0,
        closingPayableMinor: 100,
        pointPurchasesMinor: 0,
        pointPurchasesPoints: 0,
        status: "open",
        disputeReason: null,
        disputedAt: null,
        resolutionNote: null,
        resolvedAt: null,
        disputeWindowEndsAt: "2026-10-25T13:00:00.000Z",
        generatedAt: "2026-10-21T03:20:00.000Z",
        approvedBy: null,
        approvedAt: null,
        payoutTransferId: null,
      },
    ];
  }

  const BUSINESS = randomUUID();

  beforeAll(async () => {
    server = createServer((req, res) => {
      void answer(req).then(([status, body]) => {
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterAll(() => {
    server.close();
  });

  it("asks per region and week, oldest first, and generates over the same edges, signed as worker", async () => {
    const client = createWorkerLedgerClient({ baseUrl, serviceSecret: SECRET });
    const result = await runSettlementStatements(liveStatementLedger(client), () => NOW);

    expect(result).toEqual({ generated: 1, due: 1 });
    const due = calls.filter((call) => call.path === "/v1/economy/statements/due");
    // Six weeks in each of the two regions.
    expect(due).toHaveLength(12);
    expect(due.slice(0, 6).every((call) => call.body["region"] === "AU")).toBe(true);
    expect(due.slice(6).every((call) => call.body["region"] === "ID")).toBe(true);
    expect(due.map((call) => call.body["from"]).slice(0, 6)).toEqual(
      [...due.map((call) => call.body["from"]).slice(0, 6)].sort(),
    );
    expect(calls.every((call) => call.caller === "worker")).toBe(true);

    const generated = calls.filter((call) => call.path === "/v1/economy/statements/generate");
    expect(generated.map((call) => call.body)).toEqual([
      {
        businessId: BUSINESS,
        region: "AU",
        from: "2026-10-11T13:00:00.000Z",
        to: "2026-10-18T13:00:00.000Z",
      },
    ]);
  });

  it("a non-2xx from the ledger fails the run, so it is retried", async () => {
    const client = createWorkerLedgerClient({
      baseUrl,
      serviceSecret: "another-secret-another-secret-12345",
    });
    await expect(runSettlementStatements(liveStatementLedger(client), () => NOW)).rejects.toThrow(
      /answered 401/,
    );
  });
});
