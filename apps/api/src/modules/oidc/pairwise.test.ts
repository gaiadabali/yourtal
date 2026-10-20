import { describe, expect, it } from "vitest";
import { CLIENTS } from "./clients";
import { pairwiseIdentifierFor, randomSubject } from "./pairwise";

/** A store that keeps one sub per (sector, user), as oidc.subject does. */
function memoryStore() {
  const rows = new Map<string, string>();
  return {
    rows,
    subjectFor(sector: string, userId: string, fresh: () => string) {
      const key = `${sector}|${userId}`;
      const existing = rows.get(key);
      if (existing !== undefined) return Promise.resolve(existing);
      const sub = fresh();
      rows.set(key, sub);
      return Promise.resolve(sub);
    },
  };
}

const USER = "6f1c2b9e-4a7d-4c1e-9b2a-3d5e6f708192";

describe("pairwise subjects (docs/26 §1.2)", () => {
  it("are 22 characters of base64url: 128 random bits", () => {
    const sub = randomSubject();
    expect(sub).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(sub, "base64url")).toHaveLength(16);
  });

  it("are random, never derived from the user id", () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomSubject()));
    expect(seen.size).toBe(500);
    for (const sub of seen) expect(sub).not.toContain(USER.slice(0, 8));
  });

  it("are made once per sector and person, then read back", async () => {
    const store = memoryStore();
    const pairwise = pairwiseIdentifierFor(store, CLIENTS);
    const first = await pairwise(USER, "snapapp-staging-web");
    expect(await pairwise(USER, "snapapp-staging-web")).toBe(first);
    expect(store.rows.size).toBe(1);
  });

  it("are shared by SnapApp's web, phone and server clients, and differ at FTR", async () => {
    const pairwise = pairwiseIdentifierFor(memoryStore(), CLIENTS);
    const web = await pairwise(USER, "snapapp-staging-web");
    expect(await pairwise(USER, "snapapp-staging-mobile")).toBe(web);
    expect(await pairwise(USER, "snapapp-staging-server")).toBe(web);
    expect(await pairwise(USER, "ftr-staging-web")).not.toBe(web);
  });

  it("differ between people in one app", async () => {
    const pairwise = pairwiseIdentifierFor(memoryStore(), CLIENTS);
    expect(await pairwise(USER, "ftr-staging-web")).not.toBe(
      await pairwise("someone-else", "ftr-staging-web"),
    );
  });

  it("refuse a client the registry does not know", async () => {
    const pairwise = pairwiseIdentifierFor(memoryStore(), CLIENTS);
    await expect(pairwise(USER, "unknown-app")).rejects.toThrow(/no sector/);
  });
});
