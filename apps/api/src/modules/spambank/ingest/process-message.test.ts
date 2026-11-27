import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newsletter,
  newsletterFrom,
  oursDmarc,
  oursPass,
} from "../classify/fixtures/sender-fixtures";
import type { MailboxFixture } from "./test-support";
import {
  CLASSIFY,
  deleteMailboxes,
  insertMailbox,
  linkSnapapp,
  rawEmail,
  testPool,
} from "./test-support";
import type { ProcessContext } from "./process-message";
import { autoreplyDecision, processMessage } from "./process-message";
import { senderInputFromJmap } from "../classify/jmap-input";
import { classifySender } from "../classify/sender-checks";
import { parseEmail } from "./jmap-email";
import type { Folder, MailboxFolders } from "./folders";
import { folderOf } from "./folders";
import { snapappTargetFor } from "./outbox";
import { snapappReceiver } from "@yourtal/contracts/spambank/events";

/**
 * The per-message pipeline against real Postgres (BUILD.md §4.6 skip codes recorded at ingest, §4.7 leads,
 * §4.8 offers). Each case is one message through one transaction, as ingest runs it.
 */

const NOW = new Date();
const FOLDERS: MailboxFolders = {
  inboxId: "inbox",
  spamId: "spam",
  junkId: "junk",
  unreadInbox: 1,
};
const RECEIVER = snapappReceiver("staging");

let pool: Pool;
const made: string[] = [];

beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await deleteMailboxes(pool, made);
  await pool.end();
});

async function mailbox(over: Parameters<typeof insertMailbox>[1] = {}): Promise<MailboxFixture> {
  const row = await insertMailbox(pool, over);
  made.push(row.id);
  return row;
}

function context(over: Partial<ProcessContext> = {}): ProcessContext {
  return {
    classify: CLASSIFY,
    autoreplyMode: "dry_run",
    paused: false,
    snapapp: null,
    now: NOW,
    ...over,
  };
}

/** Run one raw email through `processMessage` in a transaction, like ingest does. */
async function run(
  box: MailboxFixture,
  raw: Record<string, unknown>,
  ctx: ProcessContext = context(),
  folder?: Folder,
) {
  const email = parseEmail(raw);
  if (email === null) throw new Error("fixture has no id");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const outcome = await processMessage(
      client,
      box,
      email,
      folder ?? folderOf(email, FOLDERS),
      ctx,
    );
    await client.query("COMMIT");
    return outcome;
  } finally {
    client.release();
  }
}

async function recorded(box: MailboxFixture, emailId: string) {
  const { rows } = await pool.query<{
    folder: string;
    bulk: boolean;
    dmarc_pass: boolean;
    from_org_domain: string | null;
    autoreply_decision: string;
  }>(
    "SELECT folder, bulk, dmarc_pass, from_org_domain, autoreply_decision FROM spambank.ingested_message WHERE mailbox_id = $1 AND email_id = $2",
    [box.id, emailId],
  );
  return rows[0];
}

const brand = (n: string) => `${n}${Date.now().toString(36)}.t6test`;

describe("an ordinary person's mail", () => {
  it("is recorded in the inbox with no lead and no auto-reply", async () => {
    const box = await mailbox();
    const outcome = await run(
      box,
      rawEmail({
        id: "p1",
        in: ["inbox"],
        sender: newsletter({
          from: [{ name: "Sam", email: "sam@gmail.com" }],
          "header:From:asAddresses:all": [[{ name: "Sam", email: "sam@gmail.com" }]],
          "header:Authentication-Results:asText:all": [oursPass("gmail.com")],
          "header:List-Unsubscribe:asText:all": [],
          "header:List-Unsubscribe:asURLs": null,
          "header:List-Id:asText:all": [],
          "header:Precedence:asText:all": [],
        }),
      }),
    );
    expect(outcome).toMatchObject({
      status: "processed",
      folder: "inbox",
      lead: false,
      newInbox: true,
    });
    expect(await recorded(box, "p1")).toMatchObject({
      folder: "inbox",
      bulk: false,
      autoreply_decision: "not_bulk",
    });
  });
});

describe("a newsletter that passes DMARC", () => {
  it("in Junk: a lead and a sighting in the mailbox's region, a decision of queued, no alert", async () => {
    const domain = brand("lead1");
    const box = await mailbox({ region: "ID" });
    const outcome = await run(
      box,
      rawEmail({ id: "n1", in: ["junk"], sender: newsletterFrom(`news@${domain}`, domain) }),
    );
    expect(outcome).toMatchObject({
      status: "processed",
      folder: "junk",
      lead: true,
      queueAutoreply: true,
      newInbox: false,
      decision: "queued",
    });
    expect(await recorded(box, "n1")).toMatchObject({
      folder: "junk",
      bulk: true,
      dmarc_pass: true,
      from_org_domain: domain,
    });
    const lead = await pool.query(
      "SELECT region, messages, sample_from, sample_subject, has_list_unsubscribe FROM spambank.lead WHERE org_domain = $1",
      [domain],
    );
    expect(lead.rows).toEqual([
      {
        region: "ID",
        messages: 1,
        sample_from: `news@${domain}`,
        sample_subject: "Spring sale",
        has_list_unsubscribe: true,
      },
    ]);
    const sightings = await pool.query(
      "SELECT mailbox_id FROM spambank.lead_sighting WHERE org_domain = $1",
      [domain],
    );
    expect(sightings.rows).toEqual([{ mailbox_id: box.id }]);
  });

  it("is the same lead for a second mailbox, and AU and ID lists never mix", async () => {
    const domain = brand("lead2");
    const one = await mailbox({ region: "AU" });
    const two = await mailbox({ region: "AU" });
    const other = await mailbox({ region: "ID" });
    const sender = newsletterFrom(`hello@${domain}`, domain);
    await run(one, rawEmail({ id: "a", sender }));
    await run(one, rawEmail({ id: "b", sender, subject: "Second" }));
    await run(two, rawEmail({ id: "c", sender }));
    await run(other, rawEmail({ id: "d", sender }));
    const rows = await pool.query<{ region: string; messages: number; sample_subject: string }>(
      "SELECT region, messages, sample_subject FROM spambank.lead WHERE org_domain = $1 ORDER BY region",
      [domain],
    );
    // The first sample sticks; the count is per message.
    expect(rows.rows).toEqual([
      { region: "AU", messages: 3, sample_subject: "Spring sale" },
      { region: "ID", messages: 1, sample_subject: "Spring sale" },
    ]);
    const people = await pool.query<{ region: string; people: string }>(
      "SELECT region, count(*) AS people FROM spambank.lead_sighting WHERE org_domain = $1 GROUP BY region ORDER BY region",
      [domain],
    );
    expect(people.rows).toEqual([
      { region: "AU", people: "2" },
      { region: "ID", people: "1" },
    ]);
  });

  it("is processed once: the same message again changes nothing", async () => {
    const domain = brand("dup");
    const box = await mailbox();
    const raw = rawEmail({ id: "x1", sender: newsletterFrom(`news@${domain}`, domain) });
    expect((await run(box, raw)).status).toBe("processed");
    expect((await run(box, raw)).status).toBe("duplicate");
    const lead = await pool.query("SELECT messages FROM spambank.lead WHERE org_domain = $1", [
      domain,
    ]);
    expect(lead.rows).toEqual([{ messages: 1 }]);
  });

  it("a forged DMARC verdict from someone else's Authentication-Results is not a lead", async () => {
    const domain = brand("forge");
    const box = await mailbox();
    const outcome = await run(
      box,
      rawEmail({
        id: "f1",
        sender: newsletterFrom(`news@${domain}`, domain),
      }),
      context(),
    );
    expect(outcome.status).toBe("processed");
    const spoofed = newsletter({
      from: [{ name: "X", email: `x@${domain}` }],
      "header:From:asAddresses:all": [[{ name: "X", email: `x@${domain}` }]],
      // Only a foreign authserv-id says pass; ours says fail.
      "header:Authentication-Results:asText:all": [
        oursDmarc("fail", domain),
        `evil.example; dmarc=pass header.from=${domain}`,
      ],
    });
    const second = await run(box, rawEmail({ id: "f2", sender: spoofed }));
    expect(second).toMatchObject({ status: "processed", lead: false });
    expect(await recorded(box, "f2")).toMatchObject({
      dmarc_pass: false,
      autoreply_decision: "unauthenticated",
    });
  });
});

describe("spam and mail that is not incoming", () => {
  it("GTUBE in Spam: recorded as spam, no lead, no statement, no auto-reply", async () => {
    const domain = brand("spam");
    const box = await mailbox({ statements: true });
    const outcome = await run(
      box,
      rawEmail({
        id: "g1",
        in: ["spam"],
        sender: newsletterFrom(`promo@${domain}`, domain),
        attachments: [{ blobId: "b1", name: "statement.csv", type: "text/csv", size: 100 }],
      }),
    );
    expect(outcome).toMatchObject({
      status: "processed",
      folder: "spam",
      lead: false,
      offered: 0,
      queueAutoreply: false,
      decision: "not_inbound",
    });
    expect(
      (await pool.query("SELECT 1 FROM spambank.lead WHERE org_domain = $1", [domain])).rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT 1 FROM spambank.statement_offer WHERE mailbox_id = $1", [box.id]))
        .rowCount,
    ).toBe(0);
  });

  it("Sent, Drafts and a draft keyword leave no trace", async () => {
    const box = await mailbox();
    expect(await run(box, rawEmail({ id: "s1", in: ["sent"] }))).toEqual({
      status: "ignored",
      reason: "not_incoming",
    });
    expect(await run(box, rawEmail({ id: "d1", in: ["inbox"], keywords: ["$draft"] }))).toEqual({
      status: "ignored",
      reason: "draft",
    });
    const rows = await pool.query("SELECT 1 FROM spambank.ingested_message WHERE mailbox_id = $1", [
      box.id,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it("mail from the person's own address is not new mail for an alert or a reply", async () => {
    const box = await mailbox();
    const outcome = await run(
      box,
      rawEmail({
        id: "me",
        sender: newsletter({
          from: [{ name: "Me", email: box.address }],
          "header:From:asAddresses:all": [[{ name: "Me", email: box.address }]],
        }),
      }),
    );
    expect(outcome).toMatchObject({
      status: "processed",
      newInbox: false,
      decision: "not_inbound",
    });
  });
});

describe("the auto-reply decision ingest can settle (§4.6 order)", () => {
  const pass = newsletterFrom("news@brand.com.au", "brand.com.au");
  const verdict = (raw: object) => {
    const email = parseEmail(rawEmail({ id: "v", sender: raw }));
    if (email === null) throw new Error("no id");
    return email;
  };

  it("off wins over everything; then paused; then not inbound; then stale; then the classifier", () => {
    const box = { local_part: "geewizduck", domain: "yourtal.gaiada.com" };
    const received = NOW;
    const base = { autoreplyMode: "dry_run" as const, paused: false, now: NOW };
    // Built through the real classifier, so the test cannot drift from it.
    const classified = classifySender(senderInputFromJmap(verdict(pass)), CLASSIFY);
    expect(
      autoreplyDecision(box, "inbox", classified, received, {
        ...base,
        autoreplyMode: "off",
        paused: true,
      }),
    ).toBe("disabled");
    expect(autoreplyDecision(box, "inbox", classified, received, { ...base, paused: true })).toBe(
      "paused",
    );
    expect(autoreplyDecision(box, "spam", classified, received, base)).toBe("not_inbound");
    expect(
      autoreplyDecision(box, "inbox", classified, new Date(NOW.getTime() - 49 * 3600_000), base),
    ).toBe("stale");
    expect(autoreplyDecision(box, "inbox", classified, received, base)).toBe("queued");
  });

  it("an unauthenticated newsletter is recorded unauthenticated, not queued", async () => {
    const box = await mailbox();
    const noAuth = newsletter({
      "header:Authentication-Results:asText:all": [oursPass("elsewhere.example")],
    });
    const outcome = await run(box, rawEmail({ id: "u1", sender: noAuth }));
    expect(outcome).toMatchObject({ queueAutoreply: false, decision: "unauthenticated" });
  });

  it("mode off records disabled and queues nothing", async () => {
    const domain = brand("off");
    const box = await mailbox();
    const outcome = await run(
      box,
      rawEmail({ id: "o1", sender: newsletterFrom(`news@${domain}`, domain) }),
      context({ autoreplyMode: "off" }),
    );
    expect(outcome).toMatchObject({ queueAutoreply: false, decision: "disabled", lead: true });
  });
});

describe("statements mailed to the person (§4.8)", () => {
  const SECTOR = "snapapp-staging";
  const csv = { blobId: "blob-csv", name: "statement-nov.csv", type: "text/csv", size: 4096 };
  const stmt = (domain: string) => newsletterFrom(`statements@${domain}`, domain);

  async function snapapp(box: MailboxFixture) {
    const sub = await linkSnapapp(pool, box.user_id, SECTOR);
    const target = await snapappTargetFor(pool, box.user_id, RECEIVER);
    expect(target?.sub).toBe(sub);
    return target;
  }

  it("with the switch on: offers rows and one spambank-statement event for SnapApp", async () => {
    const domain = brand("bank");
    const box = await mailbox({ statements: true });
    const target = await snapapp(box);
    const outcome = await run(
      box,
      rawEmail({
        id: "st1",
        sender: stmt(domain),
        attachments: [csv, { blobId: "img", name: "logo.png", type: "image/png", size: 10 }],
      }),
      context({ snapapp: target }),
    );
    expect(outcome).toMatchObject({ status: "processed", offered: 1, statementEventQueued: true });
    const offers = await pool.query<{
      blob_id: string;
      name: string;
      type: string;
      size: number;
      outcome: string | null;
    }>(
      "SELECT blob_id, name, type, size, outcome FROM spambank.statement_offer WHERE mailbox_id = $1",
      [box.id],
    );
    expect(offers.rows).toEqual([
      {
        blob_id: "blob-csv",
        name: "statement-nov.csv",
        type: "text/csv",
        size: 4096,
        outcome: null,
      },
    ]);
    const events = await pool.query<{
      client_id: string;
      sub: string;
      event_type: string;
      payload: Record<string, unknown>;
      expires_at: Date;
      iat: Date;
    }>(
      "SELECT client_id, sub, event_type, payload, expires_at, iat FROM spambank.app_event_outbox WHERE sub = $1",
      [target?.sub],
    );
    expect(events.rows).toHaveLength(1);
    const event = events.rows[0];
    expect(event?.client_id).toBe("snapapp-staging-server");
    expect(event?.event_type).toBe("urn:yourtal:event:spambank-statement");
    expect(event?.payload).toEqual({
      "urn:yourtal:event:spambank-statement": {
        email_id: "st1",
        received_at: expect.any(String),
        attachments: [
          { blob_id: "blob-csv", name: "statement-nov.csv", type: "text/csv", size: 4096 },
        ],
      },
    });
    // 24 hours to live (§5.5).
    expect(((event?.expires_at.getTime() ?? 0) - (event?.iat.getTime() ?? 0)) / 3_600_000).toBe(24);
  });

  it("with the switch off, nothing is offered", async () => {
    const domain = brand("off2");
    const box = await mailbox({ statements: false });
    const outcome = await run(
      box,
      rawEmail({ id: "st2", sender: stmt(domain), attachments: [csv] }),
    );
    expect(outcome).toMatchObject({ offered: 0, statementEventQueued: false });
    expect(
      (await pool.query("SELECT 1 FROM spambank.statement_offer WHERE mailbox_id = $1", [box.id]))
        .rowCount,
    ).toBe(0);
  });

  it("without a passing DMARC, nothing is offered", async () => {
    const domain = brand("nodm");
    const box = await mailbox({ statements: true });
    const sender = newsletter({
      from: [{ name: "Bank", email: `statements@${domain}` }],
      "header:From:asAddresses:all": [[{ name: "Bank", email: `statements@${domain}` }]],
      "header:Authentication-Results:asText:all": [oursDmarc("fail", domain)],
    });
    const outcome = await run(box, rawEmail({ id: "st3", sender, attachments: [csv] }));
    expect(outcome).toMatchObject({ offered: 0 });
  });

  it("without a SnapApp link the offer is kept but no event is sent", async () => {
    const domain = brand("nolink");
    const box = await mailbox({ statements: true });
    const outcome = await run(
      box,
      rawEmail({ id: "st4", sender: stmt(domain), attachments: [csv] }),
      context({ snapapp: null }),
    );
    expect(outcome).toMatchObject({ offered: 1, statementEventQueued: false });
    expect(
      (
        await pool.query(
          "SELECT 1 FROM spambank.app_event_outbox WHERE event_type = 'urn:yourtal:event:spambank-statement' AND payload->'urn:yourtal:event:spambank-statement'->>'email_id' = 'st4'",
        )
      ).rowCount,
    ).toBe(0);
  });

  it("a person who has left SnapApp has no target", async () => {
    const box = await mailbox();
    await linkSnapapp(pool, box.user_id, SECTOR, { ended: true });
    expect(await snapappTargetFor(pool, box.user_id, RECEIVER)).toBeNull();
  });
});
