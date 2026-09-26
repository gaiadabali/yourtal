import { randomBytes } from "node:crypto";
import { Controller, Inject, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { LINK_CODE_REPOSITORY } from "./persistence/link-code.repository";
import type { LinkCodeRepository } from "./persistence/link-code.repository";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { requireRegion } from "./require-region";

const CODE_TTL_MS = 10 * 60 * 1000;
/** Crockford-ish, unambiguous when read off a screen and typed elsewhere. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/**
 * `POST /api/me/linked-apps/code` (5.4.c) — a one-time code the user
 * copies into snap-app (8.4, not built yet: this only issues the code).
 */
@Controller("api/me/linked-apps")
export class LinkedAppsController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(LINK_CODE_REPOSITORY) private readonly codes: LinkCodeRepository,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  // A fresh code every call by design — replaying the same idempotency key
  // would otherwise hand back an already-issued (and possibly consumed)
  // code, defeating "one-time". A short retention just bounds the
  // idempotency table's own row lifetime, not the code's.
  @Idempotent({ retentionMs: 60_000 })
  @Authorize({ kind: "me", action: "create_link_code" })
  @Post("code")
  async issueCode(@Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    const region = await requireRegion(this.profiles, principal.id);
    const now = new Date();
    const code = randomCode();
    await this.codes.create({
      code,
      userId: principal.id,
      region,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      consumedAt: null,
    });
    return { code, expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString() };
  }
}
