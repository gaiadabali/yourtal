import { GUARDS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { RATE_LIMIT_METADATA } from "../../shared/rate-limit/rate-limit.decorator";
import type { RateLimitOptions } from "../../shared/rate-limit/rate-limit.decorator";
import { OidcClientRateLimitGuard } from "./client-rate-limit.guard";
import { TeenInviteClientGuard } from "./teen-invite-client.guard";
import { TeenInvitesController } from "./teen-invites.controller";

// The guard itself is covered in client-rate-limit.guard.test.ts (clients get separate buckets).
describe("TeenInvitesController rate limits", () => {
  it("counts per verified client, after the client guard", () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, TeenInvitesController);
    expect(guards).toEqual([TeenInviteClientGuard, OidcClientRateLimitGuard]);
  });

  it.each(["create", "read", "end"])("%s has an identity window and an ip floor 10x it", (name) => {
    const handler: unknown = Reflect.get(TeenInvitesController.prototype, name);
    const o: RateLimitOptions = Reflect.getMetadata(RATE_LIMIT_METADATA, handler as object);
    expect(o.identity).toBeDefined();
    expect(o.ip?.max).toBe((o.identity?.max ?? 0) * 10);
  });
});
