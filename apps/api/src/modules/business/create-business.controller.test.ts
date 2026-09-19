import type { Principal } from "@yourtal/authz/principal";
import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { CreateBusinessController } from "./create-business.controller";
import type { CreateBusinessRequest } from "./dto/create-business.schema";
import { InMemoryBusinessOnboardingUnitOfWork } from "./persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "./persistence/in-memory-business-store";

const validBody: CreateBusinessRequest = {
  legalName: "PT Kopi Kenangan Indonesia",
  displayName: "Kopi Kenangan",
  district: "Kemang",
  roles: ["advertiser"],
  logoUrl: null,
};

describe("CreateBusinessController", () => {
  // "rejects an anonymous caller" used to live here as an inline identity
  // check. YT-0500 moved it to `business:create` in the policy repo, where
  // policies/tests/business_test.yaml covers it and PdpGuard enforces it —
  // one endpoint answering its own question was the thing being removed.

  it("creates the business and joins the signed-in caller as owner", async () => {
    const unitOfWork = new InMemoryBusinessOnboardingUnitOfWork(new InMemoryBusinessStore());
    const signedIn: Principal = {
      id: "user-1",
      roles: ["user"],
      attr: { jurisdiction: "ID", businessRoles: {}, isSuspended: false },
    };
    const principals = { resolve: vi.fn().mockReturnValue(signedIn) };
    const controller = new CreateBusinessController(principals, unitOfWork);

    const result = await controller.create(validBody, {} as FastifyRequest);

    expect(result).toMatchObject({
      business: { displayName: "Kopi Kenangan" },
      owner: { userId: "user-1", role: "owner" },
    });
  });
});
