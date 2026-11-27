import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEAD_PAGE_SIZE, spambankLeadSchema } from "@yourtal/contracts/spambank/staff";
import { RUN, deleteMailboxes, insertMailbox, testPool } from "../ingest/test-support";
import type { MailboxFixture } from "../ingest/test-support";
import { LEAD_CSV_HEADER, csvCell, leadsToCsv } from "./leads.csv";
import {
  InvalidCursorError,
  decodeCursor,
  encodeCursor,
  escapeLike,
  exportLeads,
  listLeads,
  updateLead,
} from "./leads.store";

/**
 * The staff leads list against real Postgres (BUILD.md 4.7, 5.4): the region wall, the recipients count,
 * the filters, the keyset paging, the update, and the CSV. Every row uses this run's token in its domain so
 * the other ingest tests' leads in the same database never show up.
 */
const SUFFIX = `t7s${RUN}.test`;
const domain = (name: string): string => `${name}.${SUFFIX}`;

const pool = testPool();
let owner: Pool;
const mailboxes: MailboxFixture[] = [];

beforeAll(async () => {
  const ownerUrl = process.env["DATABASE_OWNER_URL"];
  if (ownerUrl === undefined) throw new Error("DATABASE_OWNER_URL must be set");
  // The app role may not delete leads or autoreply_domain rows; the owner cleans up.
  owner = new Pool({ connectionString: ownerUrl, max: 2 });
  for (const region of ["AU", "AU", "ID"] as const) {
    mailboxes.push(await insertMailbox(pool, { region }));
  }
});

afterAll(async () => {
  await owner.query("DELETE FROM spambank.lead WHERE org_domain LIKE $1", [`%.${SUFFIX}`]);
  await owner.query("DELETE FROM spambank.autoreply_domain WHERE org_domain LIKE $1", [
    `%.${SUFFIX}`,
  ]);
  await deleteMailboxes(
    pool,
    mailboxes.map((mailbox) => mailbox.id),
  );
  await owner.end();
  await pool.end();
});

interface LeadSeed {
  readonly region: "AU" | "ID";
  readonly orgDomain: string;
  readonly displayName?: string;
  readonly status?: string;
  readonly lastSeenAt?: string;
  readonly sightings?: readonly MailboxFixture[];
}

async function seed(lead: LeadSeed): Promise<void> {
  const seen = lead.lastSeenAt ?? "2026-11-20T10:00:00.000000Z";
  await pool.query(
    `INSERT INTO spambank.lead
       (region, org_domain, display_name, sample_from, sample_subject, first_seen_at, last_seen_at,
        messages, status)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz - interval '1 day', $6::timestamptz, 3, $7)`,
    [
      lead.region,
      lead.orgDomain,
      lead.displayName ?? null,
      `news@${lead.orgDomain}`,
      `Hello from ${lead.orgDomain}`,
      seen,
      lead.status ?? "new",
    ],
  );
  for (const mailbox of lead.sightings ?? []) {
    await pool.query(
      `INSERT INTO spambank.lead_sighting (region, org_domain, mailbox_id, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [lead.region, lead.orgDomain, mailbox.id, seen],
    );
  }
}

function au(): MailboxFixture[] {
  return mailboxes.filter((mailbox) => mailbox.region === "AU");
}

describe("the region wall and the item", () => {
  const both = domain("both");
  const idOnly = domain("idonly");
  const replied = new Date("2026-11-21T01:02:03.000Z");
  const optedOut = new Date("2026-11-22T04:05:06.000Z");

  beforeAll(async () => {
    const [mailAu1, mailAu2, mailId] = mailboxes as [
      MailboxFixture,
      MailboxFixture,
      MailboxFixture,
    ];
    await seed({
      region: "AU",
      orgDomain: both,
      displayName: "Both Co",
      sightings: [mailAu1, mailAu2],
    });
    await seed({ region: "ID", orgDomain: both, displayName: "Both Co", sightings: [mailId] });
    await seed({ region: "ID", orgDomain: idOnly, sightings: [mailId] });
    await pool.query(
      `INSERT INTO spambank.autoreply_domain (org_domain, last_replied_at, opted_out_at, replies_total)
       VALUES ($1, $2, $3, 1)`,
      [both, replied, optedOut],
    );
  });

  it("shows an AU staff member only AU leads, with the region's own recipients", async () => {
    const page = await listLeads(pool, "AU", { q: SUFFIX });
    expect(page.items.map((lead) => lead.orgDomain)).toEqual([both]);
    expect(page.items[0]?.recipients).toBe(2);
    expect(page.nextCursor).toBeNull();
  });

  it("shows an ID staff member only ID leads: the same domain counts its own region's mailboxes", async () => {
    const page = await listLeads(pool, "ID", { q: SUFFIX });
    expect(page.items.map((lead) => lead.orgDomain).sort()).toEqual([both, idOnly].sort());
    expect(page.items.find((lead) => lead.orgDomain === both)?.recipients).toBe(1);
  });

  it("returns the contract's item, with ISO timestamps and the global auto-reply dates", async () => {
    const [item] = (await listLeads(pool, "AU", { q: SUFFIX })).items;
    expect(() => spambankLeadSchema.parse(item)).not.toThrow();
    expect(item).toMatchObject({
      orgDomain: both,
      displayName: "Both Co",
      sampleFrom: `news@${both}`,
      sampleSubject: `Hello from ${both}`,
      messages: 3,
      status: "new",
      note: null,
      firstSeenAt: "2026-11-19T10:00:00.000Z",
      lastSeenAt: "2026-11-20T10:00:00.000Z",
      autoRepliedAt: replied.toISOString(),
      optedOutAt: optedOut.toISOString(),
    });
    // The ID-only brand has no auto-reply row: both dates are null, not missing.
    const idItem = (await listLeads(pool, "ID", { q: idOnly })).items[0];
    expect(idItem?.autoRepliedAt).toBeNull();
    expect(idItem?.optedOutAt).toBeNull();
  });
});

describe("the filters", () => {
  beforeAll(async () => {
    await seed({ region: "AU", orgDomain: domain("pct1"), displayName: `Alpha ${RUN} 50% off` });
    await seed({ region: "AU", orgDomain: domain("pct2"), displayName: `Alpha ${RUN} 50x off` });
    await seed({ region: "AU", orgDomain: domain("under1"), displayName: `Beta_${RUN}` });
    await seed({ region: "AU", orgDomain: domain("under2"), displayName: `BetaX${RUN}` });
    await seed({ region: "AU", orgDomain: domain("hot"), status: "contacted" });
    await seed({ region: "AU", orgDomain: domain("gone"), status: "ignored" });
  });

  it("matches the domain or the display name, ignoring case", async () => {
    const byName = await listLeads(pool, "AU", { q: `ALPHA ${RUN.toUpperCase()}` });
    expect(byName.items.map((lead) => lead.orgDomain).sort()).toEqual(
      [domain("pct1"), domain("pct2")].sort(),
    );
    const byDomain = await listLeads(pool, "AU", { q: `HOT.${SUFFIX.toUpperCase()}` });
    expect(byDomain.items.map((lead) => lead.orgDomain)).toEqual([domain("hot")]);
  });

  it("treats % and _ in the search as plain characters", async () => {
    const percent = await listLeads(pool, "AU", { q: `${RUN} 50%` });
    expect(percent.items.map((lead) => lead.orgDomain)).toEqual([domain("pct1")]);
    const underscore = await listLeads(pool, "AU", { q: `beta_${RUN}` });
    expect(underscore.items.map((lead) => lead.orgDomain)).toEqual([domain("under1")]);
  });

  it("filters by status, and combines it with the search", async () => {
    const contacted = await listLeads(pool, "AU", { status: "contacted", q: SUFFIX });
    expect(contacted.items.map((lead) => lead.orgDomain)).toEqual([domain("hot")]);
    const none = await listLeads(pool, "AU", { status: "customer", q: SUFFIX });
    expect(none.items).toEqual([]);
  });
});

describe("paging and export", () => {
  const TOTAL = LEAD_PAGE_SIZE + 3;
  const PG = `pg${RUN}`;
  const paged = (i: number): string => `${PG}-${String(i).padStart(2, "0")}.${SUFFIX}`;

  beforeAll(async () => {
    // Pairs share a last_seen_at (to the microsecond), so the domain tiebreak and the cursor's
    // precision both matter. Inserted in a shuffled order.
    for (const i of [...Array(TOTAL).keys()].reverse()) {
      const second = String(59 - Math.floor(i / 2)).padStart(2, "0");
      await seed({
        region: "AU",
        orgDomain: paged(i),
        lastSeenAt: `2026-11-20T09:00:${second}.123457Z`,
      });
    }
  });

  const expected = (): string[] => [...Array(TOTAL).keys()].map(paged);

  it("pages by last seen then domain, with a cursor until the end", async () => {
    const first = await listLeads(pool, "AU", { q: PG });
    expect(first.items).toHaveLength(LEAD_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await listLeads(pool, "AU", {
      q: PG,
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
    });
    expect(second.items).toHaveLength(TOTAL - LEAD_PAGE_SIZE);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((lead) => lead.orgDomain)).toEqual(expected());
  });

  it("exports the whole filtered list in the same order, past the page size", async () => {
    const rows = await exportLeads(pool, "AU", { q: PG });
    expect(rows.map((lead) => lead.orgDomain)).toEqual(expected());
    // The ID staff member gets none of it.
    expect(await exportLeads(pool, "ID", { q: PG })).toEqual([]);
  });

  it("refuses a cursor it did not give out", async () => {
    await expect(listLeads(pool, "AU", { q: PG, cursor: "AAAA" })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
    const forged = encodeCursor("2026-11-20; DROP TABLE", "x");
    await expect(listLeads(pool, "AU", { cursor: forged })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it("round-trips a cursor", () => {
    const cursor = encodeCursor("2026-11-20T09:00:59.123457Z", "a.example");
    expect(decodeCursor(cursor)).toEqual({ t: "2026-11-20T09:00:59.123457Z", d: "a.example" });
  });
});

describe("updating a lead", () => {
  const mine = domain("upd");
  const theirs = domain("updid");

  beforeAll(async () => {
    await seed({ region: "AU", orgDomain: mine, sightings: [au()[0] as MailboxFixture] });
    await seed({ region: "ID", orgDomain: theirs });
  });

  it("sets the status and note in the staff member's region and returns the item", async () => {
    const lead = await updateLead(pool, "AU", mine.toUpperCase(), {
      status: "contacted",
      note: "Called on Monday",
    });
    expect(lead).toMatchObject({
      orgDomain: mine,
      status: "contacted",
      note: "Called on Monday",
      recipients: 1,
    });
  });

  it("changes only what was sent, and null (or empty) clears the note", async () => {
    await updateLead(pool, "AU", mine, { status: "customer" });
    expect(await updateLead(pool, "AU", mine, { note: null })).toMatchObject({
      status: "customer",
      note: null,
    });
    await updateLead(pool, "AU", mine, { note: "again" });
    expect(await updateLead(pool, "AU", mine, { note: "" })).toMatchObject({ note: null });
    expect(await updateLead(pool, "AU", mine, { status: "ignored" })).toMatchObject({
      status: "ignored",
      note: null,
    });
  });

  it("finds nothing in the other region, and leaves that lead alone", async () => {
    expect(await updateLead(pool, "AU", theirs, { status: "customer", note: "x" })).toBeNull();
    const [row] = (
      await pool.query<{ status: string; note: string | null }>(
        "SELECT status, note FROM spambank.lead WHERE region = 'ID' AND org_domain = $1",
        [theirs],
      )
    ).rows;
    expect(row).toEqual({ status: "new", note: null });
    expect(await updateLead(pool, "AU", domain("nobody"), { status: "ignored" })).toBeNull();
  });
});

describe("the CSV", () => {
  it("quotes per RFC 4180", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(7)).toBe("7");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("neutralises a cell that would run as a spreadsheet formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe('"\'\rx"');
    // A formula that also needs quoting gets both.
    expect(csvCell('=A1,"b"')).toBe('"\'=A1,""b"""');
    // Not at the start: left alone.
    expect(csvCell("a=b")).toBe("a=b");
  });

  it("writes the header and one CRLF row per lead", () => {
    const lead = spambankLeadSchema.parse({
      orgDomain: "brand.example",
      displayName: "=Brand, Inc.",
      sampleFrom: null,
      sampleSubject: "Hi",
      recipients: 2,
      messages: 5,
      firstSeenAt: "2026-11-19T10:00:00.000Z",
      lastSeenAt: "2026-11-20T10:00:00.000Z",
      status: "new",
      note: null,
      autoRepliedAt: null,
      optedOutAt: null,
    });
    expect(LEAD_CSV_HEADER).toBe(
      "orgDomain,displayName,sampleFrom,sampleSubject,recipients,messages,firstSeenAt,lastSeenAt,status,note,autoRepliedAt,optedOutAt",
    );
    expect(leadsToCsv([lead])).toBe(
      `${LEAD_CSV_HEADER}\r\n` +
        `brand.example,"'=Brand, Inc.",,Hi,2,5,2026-11-19T10:00:00.000Z,2026-11-20T10:00:00.000Z,new,,,\r\n`,
    );
    expect(leadsToCsv([])).toBe(`${LEAD_CSV_HEADER}\r\n`);
  });

  it("escapes the LIKE wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});
