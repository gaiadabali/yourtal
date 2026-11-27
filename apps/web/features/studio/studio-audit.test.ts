import { describe, expect, it } from "vitest";
import { businessMemberSchema } from "@yourtal/contracts/business/member";
import { buildTeamAuditTrail, describeAuditEntry } from "./studio-audit";
import { getStudioTranslator } from "./studio-i18n";

const OWNER_ID = "00000000-0000-4000-8000-000000000710";
const profileOf = (userId: string) => ({ name: `name-${userId.slice(-3)}`, email: "" });

describe("buildTeamAuditTrail", () => {
  it("emits an invite entry and a join entry for a member who has joined", () => {
    const member = businessMemberSchema.parse({
      businessId: "00000000-0000-4000-8000-000000000601",
      userId: "00000000-0000-4000-8000-000000000711",
      role: "admin",
      invitedAt: "2025-02-01T09:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: "2025-02-02T10:00:00.000Z",
    });

    const trail = buildTeamAuditTrail([member], profileOf);

    expect(trail).toHaveLength(2);
    expect(trail.map((entry) => entry.action)).toEqual(["joined", "invited"]);
  });

  it("words each entry with the names it is given, so a real name or email shows rather than a placeholder", () => {
    const member = businessMemberSchema.parse({
      businessId: "00000000-0000-4000-8000-000000000601",
      userId: "00000000-0000-4000-8000-000000000711",
      role: "admin",
      invitedAt: "2025-02-01T09:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: null,
    });
    const names: Record<string, string> = {
      [OWNER_ID]: "Hansel",
      [member.userId]: "ana@example.com",
    };
    const [entry] = buildTeamAuditTrail([member], (id) => ({ name: names[id] ?? "?", email: "" }));
    expect(entry?.params).toMatchObject({ actor: "Hansel", name: "ana@example.com" });
  });

  it("emits only an invite entry for a pending member — no join entry invented", () => {
    const pending = businessMemberSchema.parse({
      businessId: "00000000-0000-4000-8000-000000000601",
      userId: "00000000-0000-4000-8000-000000000701",
      role: "marketer",
      invitedAt: "2025-04-01T09:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: null,
    });

    const trail = buildTeamAuditTrail([pending], profileOf);

    expect(trail).toHaveLength(1);
    expect(trail[0]?.action).toBe("invited");
  });

  it("sorts newest first regardless of roster order", () => {
    const older = businessMemberSchema.parse({
      businessId: "00000000-0000-4000-8000-000000000601",
      userId: "00000000-0000-4000-8000-000000000711",
      role: "admin",
      invitedAt: "2025-01-01T09:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: null,
    });
    const newer = businessMemberSchema.parse({
      businessId: "00000000-0000-4000-8000-000000000601",
      userId: "00000000-0000-4000-8000-000000000712",
      role: "analyst",
      invitedAt: "2025-06-01T09:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: null,
    });

    const trail = buildTeamAuditTrail([older, newer], profileOf);

    expect(trail[0]?.id).toBe("invite-00000000-0000-4000-8000-000000000712");
    expect(trail[1]?.id).toBe("invite-00000000-0000-4000-8000-000000000711");
  });
});

describe("describeAuditEntry", () => {
  const entry = {
    id: "x",
    occurredAt: "2025-02-01T09:00:00.000Z",
    action: "role_changed" as const,
    message: "roleChanged" as const,
    params: { name: "Sari", fromRole: "marketer" as const, toRole: "finance" as const },
  };

  it("words an entry in the viewer's language, role names included", () => {
    expect(describeAuditEntry(entry, getStudioTranslator("en-AU"))).toBe(
      "Sari's role changed from Marketer to Finance",
    );
    expect(describeAuditEntry(entry, getStudioTranslator("id-ID"))).toBe(
      "Peran Sari diubah dari Pemasar menjadi Keuangan",
    );
  });
});
