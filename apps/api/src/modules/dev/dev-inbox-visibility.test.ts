import { describe, expect, it } from "vitest";
import { decideInboxView, inboxEnvironment, normaliseAddress } from "./dev-inbox-visibility";

const entries = [
  { id: "1", recipient: "Viewer@Example.test" },
  { id: "2", recipient: "someone-else@example.test" },
  { id: "3", recipient: " viewer@example.test " },
  { id: "4", recipient: "guardian@example.test" },
] as const;

const viewer = { staff: false, email: "viewer@example.test" };
const staff = { staff: true, email: "staff@example.test" };

describe("inboxEnvironment (5.13.b)", () => {
  it("closes production, opens dev and gates staging", () => {
    expect(inboxEnvironment("production")).toBe("closed");
    expect(inboxEnvironment("dev")).toBe("open");
    expect(inboxEnvironment("staging")).toBe("gated");
  });

  it("gates any value it does not recognise, rather than opening it", () => {
    expect(inboxEnvironment("")).toBe("gated");
    expect(inboxEnvironment("Production")).toBe("gated");
    expect(inboxEnvironment("preview")).toBe("gated");
  });
});

describe("decideInboxView (5.13.b)", () => {
  it("refuses in production as not found, whoever asks", () => {
    for (const who of [null, viewer, staff]) {
      expect(decideInboxView("production", who, entries)).toEqual({
        kind: "refused",
        reason: "not_found",
      });
    }
  });

  it("shows everything in dev, with or without a session", () => {
    for (const who of [null, viewer]) {
      expect(decideInboxView("dev", who, entries)).toEqual({
        kind: "visible",
        access: "open",
        entries,
      });
    }
  });

  it("requires a session on staging", () => {
    expect(decideInboxView("staging", null, entries)).toEqual({
      kind: "refused",
      reason: "sign_in_required",
    });
  });

  it("requires a session for an unrecognised environment too", () => {
    expect(decideInboxView("preview", null, entries)).toEqual({
      kind: "refused",
      reason: "sign_in_required",
    });
  });

  it("shows staff on staging every entry", () => {
    expect(decideInboxView("staging", staff, entries)).toEqual({
      kind: "visible",
      access: "staff",
      entries,
    });
  });

  it("shows anyone else on staging only mail to their own email, case-insensitively", () => {
    const view = decideInboxView("staging", viewer, entries);
    expect(view).toEqual({
      kind: "visible",
      access: "own",
      entries: [entries[0], entries[2]],
    });
  });

  it("matches when the viewer's own email has different case", () => {
    const view = decideInboxView(
      "staging",
      { staff: false, email: "VIEWER@example.TEST" },
      entries,
    );
    expect(view.kind === "visible" ? view.entries.map((entry) => entry.id) : []).toEqual([
      "1",
      "3",
    ]);
  });

  it("lets a signed-in guardian see their own consent email", () => {
    const view = decideInboxView(
      "staging",
      { staff: false, email: "guardian@example.test" },
      entries,
    );
    expect(view.kind === "visible" ? view.entries.map((entry) => entry.id) : []).toEqual(["4"]);
  });

  it("shows nothing to a non-staff account with no sign-in email", () => {
    for (const email of [null, "", "   "]) {
      expect(decideInboxView("staging", { staff: false, email }, entries)).toEqual({
        kind: "visible",
        access: "own",
        entries: [],
      });
    }
  });

  it("shows nothing when none of the entries are the viewer's", () => {
    expect(
      decideInboxView("staging", { staff: false, email: "nobody@example.test" }, entries),
    ).toEqual({ kind: "visible", access: "own", entries: [] });
  });
});

describe("normaliseAddress", () => {
  it("trims and lower-cases", () => {
    expect(normaliseAddress("  A.B@Example.TEST ")).toBe("a.b@example.test");
  });
});
