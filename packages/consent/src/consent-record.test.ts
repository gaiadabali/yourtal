import { describe, expect, it } from "vitest";
import { consentRecordSchema, latestPerPurpose } from "./consent-record";

const USER = "11111111-1111-4111-8111-111111111111";

const VALID = {
  userId: USER,
  purpose: "declared_interest_targeting",
  jurisdiction: "ID",
  policyVersionId: "id-2026-09-01",
  state: "granted",
  recordedAt: "2026-09-10T00:00:00Z",
  source: "settings_toggle",
} as const;

describe("consentRecordSchema", () => {
  it("round-trips a valid record", () => {
    expect(consentRecordSchema.parse(VALID)).toEqual(VALID);
  });

  it.each([
    ["a non-uuid userId", { userId: "wina" }],
    ["a purpose outside the catalogue", { purpose: "to_improve_our_services" }],
    ["a jurisdiction we have no policy for", { jurisdiction: "SG" }],
    ["an empty policy version", { policyVersionId: "" }],
    ["a state that is neither granted nor withdrawn", { state: "pending" }],
    ["a non-RFC3339 timestamp", { recordedAt: "10 September 2026" }],
    ["a timestamp with no offset", { recordedAt: "2026-09-10T00:00:00" }],
    ["a source that is not one of the known entry points", { source: "guessed" }],
  ])("rejects %s", (_label, override) => {
    expect(consentRecordSchema.safeParse({ ...VALID, ...override }).success).toBe(false);
  });

  it("rejects an unknown extra field rather than ignoring it", () => {
    // .strict(): a field the schema does not know is a caller believing
    // something is stored that is not. Silently dropping it is worse than
    // failing, because the caller carries on assuming it took effect.
    expect(consentRecordSchema.safeParse({ ...VALID, grantedBy: "support" }).success).toBe(false);
  });

  it("rejects a record with no state rather than defaulting to granted", () => {
    const { state: _state, ...withoutState } = VALID;
    expect(consentRecordSchema.safeParse(withoutState).success).toBe(false);
  });
});

describe("latestPerPurpose", () => {
  // Loosely typed on purpose: `VALID` is `as const`, so a `Partial` of it
  // would narrow every field to the one literal it already holds and reject
  // the variations these tests exist to make. Zod validates on the way in.
  function record(over: Record<string, unknown> = {}) {
    return consentRecordSchema.parse({ ...VALID, ...over });
  }

  it("keeps the most recent record per purpose", () => {
    const latest = latestPerPurpose([
      record({ recordedAt: "2026-09-10T00:00:00Z" }),
      record({ recordedAt: "2026-09-12T00:00:00Z", state: "withdrawn" }),
      record({ recordedAt: "2026-09-11T00:00:00Z" }),
    ]);

    expect(latest.get("declared_interest_targeting:ID")?.recordedAt).toBe("2026-09-12T00:00:00Z");
  });

  it("is not confused by the order records arrive in", () => {
    const ascending = latestPerPurpose([
      record({ recordedAt: "2026-09-10T00:00:00Z" }),
      record({ recordedAt: "2026-09-11T00:00:00Z", state: "withdrawn" }),
    ]);
    const descending = latestPerPurpose([
      record({ recordedAt: "2026-09-11T00:00:00Z", state: "withdrawn" }),
      record({ recordedAt: "2026-09-10T00:00:00Z" }),
    ]);

    expect(ascending.get("declared_interest_targeting:ID")?.state).toBe("withdrawn");
    expect(descending.get("declared_interest_targeting:ID")?.state).toBe("withdrawn");
  });

  it("resolves a same-instant tie toward withdrawal", () => {
    // Two records at one timestamp is a clock skew or an import artefact.
    // Resolving it toward "allowed" is the one direction that cannot be
    // undone once the data has been used.
    const latest = latestPerPurpose([
      record({ recordedAt: "2026-09-10T00:00:00Z", state: "granted" }),
      record({ recordedAt: "2026-09-10T00:00:00Z", state: "withdrawn" }),
    ]);

    expect(latest.get("declared_interest_targeting:ID")?.state).toBe("withdrawn");
  });

  it("resolves the same tie the same way whichever order they arrive", () => {
    const latest = latestPerPurpose([
      record({ recordedAt: "2026-09-10T00:00:00Z", state: "withdrawn" }),
      record({ recordedAt: "2026-09-10T00:00:00Z", state: "granted" }),
    ]);

    expect(latest.get("declared_interest_targeting:ID")?.state).toBe("withdrawn");
  });

  it("keys separately per jurisdiction", () => {
    const latest = latestPerPurpose([
      record({ jurisdiction: "ID" }),
      record({ jurisdiction: "AU", state: "withdrawn" }),
    ]);

    expect(latest.get("declared_interest_targeting:ID")?.state).toBe("granted");
    expect(latest.get("declared_interest_targeting:AU")?.state).toBe("withdrawn");
  });
});
