import type { Principal } from "@yourtal/authz/principal";
import { describe, expect, it, vi, beforeAll } from "vitest";
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
};

/**
 * A clean start, not only a clean finish.
 *
 * These tests share one database (the package runs serially for that
 * reason). A run that fails part-way leaves its rows behind, and the next
 * one then trips a unique index and fails for a reason unrelated to what it
 * tests — burying a real failure under a fake one. Clearing before is what
 * makes the suite repeatable; clearing after only helps when the previous
 * run got that far.
 */
beforeAll(async () => {
  await clearBusinessTables(testBusinessDb());
});

describe("CreateBusinessController", () => {
  // "rejects an anonymous caller" used to live here as an inline identity
  // check. YT-0500 moved it to `business:create` in the policy repo, where
  // policies/tests/business_test.yaml covers it and PdpGuard enforces it —
  // one endpoint answering its own question was the thing being removed.

  it("creates the business and joins the signed-in caller as owner", async () => {
    const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(testBusinessDb());
    const signedIn: Principal = {
      id: "user-1",
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
      owner: { userId: "user-1", role: "owner" },
    });
  });
});
