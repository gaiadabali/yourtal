import type { Principal } from "@yourtal/authz/principal";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessOnboardingUnitOfWork } from "./persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "./persistence/business-db.test-helper";
import type { FastifyRequest } from "fastify";
import type { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { CreateBusinessController } from "./create-business.controller";
import type { CreateBusinessRequest } from "./dto/create-business.schema";

const validBody: CreateBusinessRequest = {
  legalName: "PT Kopi Kenangan Indonesia",
  displayName: "Kopi Kenangan",
  district: "Kemang",
  roles: ["advertiser"],
  logoUrl: null,
  region: "ID",
  handle: "kopi-kenangan-ctrl-test",
  coverUrl: null,
};

/**
 * A fixture id unique to THIS FILE, not `"user-1"` shared with siblings —
 * see `persistence/business-db.test-helper.ts` for why that used to be
 * unsafe.
 */
const SIGNED_IN_ID = "user-create-business-controller";

/**
 * A clean start, not only a clean finish — scoped to this file's own
 * fixtures now, not the whole table. See
 * `persistence/business-db.test-helper.ts`.
 */
beforeAll(async () => {
  await clearBusinessTables(testBusinessDb(), [SIGNED_IN_ID]);
});

afterAll(async () => {
  await clearBusinessTables(testBusinessDb(), [SIGNED_IN_ID]);
});

describe("CreateBusinessController", () => {
  // "rejects an anonymous caller" used to live here as an inline identity
  // check. YT-0500 moved it to `business:create` in the policy repo, where
  // policies/tests/business_test.yaml covers it and PdpGuard enforces it —
  // one endpoint answering its own question was the thing being removed.

  it("creates the business and joins the signed-in caller as owner", async () => {
    const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(testBusinessDb());
    const signedIn: Principal = {
      id: SIGNED_IN_ID,
      roles: ["user"],
      attr: { jurisdiction: "ID", businessRoles: {}, isSuspended: false },
    };
    const principals = {
      resolve: vi.fn().mockResolvedValue(signedIn),
    } as unknown as AsyncPrincipalResolver;
    const controller = new CreateBusinessController(principals, unitOfWork);

    const result = await controller.create(validBody, {} as FastifyRequest);

    expect(result).toMatchObject({
      business: { displayName: "Kopi Kenangan" },
      owner: { userId: SIGNED_IN_ID, role: "owner" },
    });
  });
});
