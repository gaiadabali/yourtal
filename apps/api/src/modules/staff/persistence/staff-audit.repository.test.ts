import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ownerPool } from "../staff.test-helper";
import { PostgresStaffAuditRepository } from "./staff-audit.repository";

const app = new Pool({ connectionString: process.env["DATABASE_URL"] });
const owner = ownerPool();
const audit = new PostgresStaffAuditRepository(app);

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe("staff.audit_event", () => {
  it("records an event through the app role", async () => {
    const actor = randomUUID();
    await audit.record({
      actorUserId: actor,
      actorRoles: ["ops"],
      action: "kyb.approve",
      outcome: "succeeded",
      httpStatus: 201,
      targetKind: "business",
      targetId: "biz-1",
      region: "AU",
      reason: "documents match",
      detail: { documentId: "doc-1" },
    });
    const rows = await app.query(
      `SELECT action, outcome, http_status, target_id, region, reason, detail
         FROM staff.audit_event WHERE actor_user_id = $1`,
      [actor],
    );
    expect(rows.rows).toEqual([
      {
        action: "kyb.approve",
        outcome: "succeeded",
        http_status: 201,
        target_id: "biz-1",
        region: "AU",
        reason: "documents match",
        detail: { documentId: "doc-1" },
      },
    ]);
  });

  it("is append-only, even for the owner", async () => {
    const actor = randomUUID();
    await audit.record({
      actorUserId: actor,
      actorRoles: ["support"],
      action: "user.view_ledger",
      outcome: "succeeded",
      httpStatus: 200,
    });
    await expect(
      owner.query(`UPDATE staff.audit_event SET outcome = 'failed' WHERE actor_user_id = $1`, [
        actor,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      owner.query(`DELETE FROM staff.audit_event WHERE actor_user_id = $1`, [actor]),
    ).rejects.toThrow(/append-only/);
    await expect(
      app.query(`DELETE FROM staff.audit_event WHERE actor_user_id = $1`, [actor]),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses an action name that is not a dotted verb", async () => {
    await expect(
      audit.record({
        actorUserId: randomUUID(),
        actorRoles: ["ops"],
        action: "Approve KYB",
        outcome: "succeeded",
        httpStatus: 200,
      }),
    ).rejects.toThrow(/check constraint/);
  });
});
