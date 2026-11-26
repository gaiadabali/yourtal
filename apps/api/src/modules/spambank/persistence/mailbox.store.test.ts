import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgMailboxStore } from "./mailbox.store";

/**
 * The management API's mailbox store against real Postgres, as the app role: the one-mailbox-per-person
 * rule, the retired-name backstop, `provisioning` to `active`, the settings, the erase and the
 * per-person lock.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? process.env["TEST_DATABASE_URL"];
const OWNER_URL = process.env["DATABASE_OWNER_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL must be set");
if (OWNER_URL === undefined) throw new Error("DATABASE_OWNER_URL must be set");

const RUN = Date.now().toString(36);
const toLetters = (text: string): string =>
  text.replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)] ?? "a");
const nameOf = (n: number): string =>
  `ms${toLetters(RUN)}${toLetters(String(n + 1000))}`.slice(0, 16);

let pool: Pool;
let owner: Pool;
let store: ReturnType<typeof createPgMailboxStore>;
const users: string[] = [];
const names: string[] = [];
let counter = 0;

function fresh(region: "AU" | "ID" = "AU", via: "yourtal" | "snapapp" | "ftr" = "yourtal") {
  counter += 1;
  const userId = `store-${RUN}-${String(counter)}`;
  const localPart = nameOf(counter);
  users.push(userId);
  names.push(localPart);
  return { userId, localPart, region, domain: "yourtal.gaiada.com", enabledVia: via };
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  store = createPgMailboxStore(pool);
});

afterAll(async () => {
  await owner.query(`DELETE FROM spambank.mailbox WHERE user_id = ANY($1)`, [users]);
  await owner.query(`DELETE FROM spambank.retired_name WHERE local_part = ANY($1)`, [names]);
  await pool.end();
  await owner.end();
});

describe("the mailbox store", () => {
  it("inserts a provisioning mailbox, finds it by person, and returns the person's own on a second insert", async () => {
    const input = fresh("ID", "snapapp");
    const inserted = await store.insertProvisioning(input);
    expect(inserted.kind).toBe("inserted");
    expect(await store.find(input.userId)).toMatchObject({
      userId: input.userId,
      region: "ID",
      localPart: input.localPart,
      domain: "yourtal.gaiada.com",
      status: "provisioning",
      enabledVia: "snapapp",
      stalwartAccountId: null,
      statementsToSnapapp: false,
      newMailAlerts: true,
    });
    const second = await store.insertProvisioning({ ...input, localPart: nameOf(900 + counter) });
    names.push(nameOf(900 + counter));
    expect(second.kind).toBe("user_exists");
    expect(second.kind === "user_exists" && second.mailbox.localPart).toBe(input.localPart);
    expect(await store.find(`store-${RUN}-nobody`)).toBeNull();
  });

  it("says name_taken for a name in use, and for a retired one", async () => {
    const first = fresh();
    await store.insertProvisioning(first);
    const clash = { ...fresh(), localPart: first.localPart };
    expect((await store.insertProvisioning(clash)).kind).toBe("name_taken");

    const retiredName = nameOf(800 + counter);
    names.push(retiredName);
    await pool.query(`INSERT INTO spambank.retired_name (local_part) VALUES ($1)`, [retiredName]);
    const onRetired = { ...fresh(), localPart: retiredName };
    expect((await store.insertProvisioning(onRetired)).kind).toBe("name_taken");
    expect(await store.find(onRetired.userId)).toBeNull();
  });

  it("makes a provisioning mailbox active once, with the folder and state it was set up with", async () => {
    const input = fresh();
    const made = await store.insertProvisioning(input);
    if (made.kind !== "inserted") throw new Error("not inserted");
    await store.setStalwartAccount(made.mailbox.id, `acct-${RUN}-${String(counter)}`);
    const active = await store.activate(made.mailbox.id, { junkMailboxId: "j1", emailState: "s1" });
    expect(active).toMatchObject({
      status: "active",
      junkMailboxId: "j1",
      emailState: "s1",
      stalwartAccountId: `acct-${RUN}-${String(counter)}`,
    });
    // Already active: nothing more to activate.
    expect(
      await store.activate(made.mailbox.id, { junkMailboxId: "j2", emailState: "s2" }),
    ).toBeNull();
  });

  it("discards a provisioning row, retiring the name when asked, and never an active one", async () => {
    const dropped = fresh();
    const made = await store.insertProvisioning(dropped);
    if (made.kind !== "inserted") throw new Error("not inserted");
    await store.discardProvisioning(made.mailbox.id, dropped.localPart, true);
    expect(await store.find(dropped.userId)).toBeNull();
    const retired = await pool.query(`SELECT 1 FROM spambank.retired_name WHERE local_part = $1`, [
      dropped.localPart,
    ]);
    expect(retired.rowCount).toBe(1);

    const kept = fresh();
    const active = await store.insertProvisioning(kept);
    if (active.kind !== "inserted") throw new Error("not inserted");
    await store.activate(active.mailbox.id, { junkMailboxId: null, emailState: null });
    await store.discardProvisioning(active.mailbox.id, kept.localPart, false);
    expect((await store.find(kept.userId))?.status).toBe("active");
  });

  it("changes only the settings that were sent, and only on a mailbox that is in use", async () => {
    const input = fresh();
    const made = await store.insertProvisioning(input);
    if (made.kind !== "inserted") throw new Error("not inserted");
    // Still provisioning: no settings yet.
    expect(await store.updateSettings(made.mailbox.id, { newMailAlerts: false })).toBeNull();
    await store.activate(made.mailbox.id, { junkMailboxId: null, emailState: null });
    expect(await store.updateSettings(made.mailbox.id, { newMailAlerts: false })).toMatchObject({
      newMailAlerts: false,
      statementsToSnapapp: false,
    });
    expect(
      await store.updateSettings(made.mailbox.id, { statementsToSnapapp: true }),
    ).toMatchObject({ newMailAlerts: false, statementsToSnapapp: true });
  });

  it("erases: erasing, name retired, and removeErasing deletes only an erasing row", async () => {
    const input = fresh();
    const made = await store.insertProvisioning(input);
    if (made.kind !== "inserted") throw new Error("not inserted");
    await store.activate(made.mailbox.id, { junkMailboxId: null, emailState: null });

    await store.removeErasing(made.mailbox.id);
    expect(await store.find(input.userId)).not.toBeNull();

    expect(await store.erase(input.userId)).toBeGreaterThan(0);
    expect((await store.find(input.userId))?.status).toBe("erasing");
    const retired = await pool.query(`SELECT 1 FROM spambank.retired_name WHERE local_part = $1`, [
      input.localPart,
    ]);
    expect(retired.rowCount).toBe(1);
    await store.removeErasing(made.mailbox.id);
    expect(await store.find(input.userId)).toBeNull();
  });

  it("runs one person's work one at a time, and different people's together", async () => {
    const order: string[] = [];
    const gate = new Promise<void>((resolve) => setTimeout(resolve, 150));
    const a1 = store.withUserLock("lock-user-a", async () => {
      order.push("a1 start");
      await gate;
      order.push("a1 end");
    });
    // Let a1 take the lock first.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const a2 = store.withUserLock("lock-user-a", () => {
      order.push("a2");
      return Promise.resolve();
    });
    const b = store.withUserLock("lock-user-b", () => {
      order.push("b");
      return Promise.resolve();
    });
    await Promise.all([a1, a2, b]);
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a1 end"));
    expect(order.indexOf("a2")).toBeGreaterThan(order.indexOf("a1 end"));
  });

  it("releases the lock when the work throws", async () => {
    await expect(
      store.withUserLock("lock-user-c", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(store.withUserLock("lock-user-c", () => Promise.resolve("again"))).resolves.toBe(
      "again",
    );
  });
});
