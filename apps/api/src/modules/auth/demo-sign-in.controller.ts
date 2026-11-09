import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { DEMO_PEOPLE } from "@yourtal/db/demo-world/people";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { Authorize, PublicRoute } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { LOGIN_RATE_LIMIT, RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import {
  CREDENTIAL_REPOSITORY,
  PASSWORD_CREDENTIAL_KIND,
} from "./persistence/credential.repository";
import type { CredentialRepository } from "./persistence/credential.repository";
import { SecondFactorGate } from "./factors/second-factor-gate";
import { passwordSignInBody } from "./auth.controller";
import { normalizeEmail } from "./email";
import { DEMO_AMR } from "./session/amr";

const demoSignInSchema = z.object({ email: z.string().trim().toLowerCase().max(320) });
class DemoSignInDto extends createZodDto(demoSignInSchema) {}

/**
 * Only the non-staff people the demo-world reset creates. Staff demo accounts
 * (admin, support, ...) keep needing their password: a password-less staff
 * session would open the staff console and every inbox to the internet.
 */
const PASSWORDLESS_PEOPLE = DEMO_PEOPLE.filter((p) => p.staffRole === undefined);
const DEMO_EMAILS: ReadonlySet<string> = new Set(PASSWORDLESS_PEOPLE.map((p) => p.email));

/**
 * Staging test kit K1.1: sign in as a seeded demo person without a password,
 * like SnapApp's google-simulator. Staging only (`APP_ENV=staging`, so an
 * unset APP_ENV is off); everywhere else both routes are 404. After the
 * allow-list check it is the password path from "password correct" on
 * (`SecondFactorGate.afterPassword`), so an authenticator app is still asked
 * for and every session-time guard (teen, guardian, suspension) still applies.
 * The session's amr is `demo`: it cannot change sign-in methods or the
 * password, and OIDC refuses it for every client but SnapApp's staging ones.
 */
@Controller("api/auth/demo-sign-in")
export class DemoSignInController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    private readonly secondFactor: SecondFactorGate,
  ) {}

  @PublicRoute("Staging only: the seeded demo people the sign-in page offers. 404 elsewhere.")
  @Get()
  people() {
    this.assertStaging();
    return {
      people: PASSWORDLESS_PEOPLE.map(({ email, displayName, region }) => ({
        email,
        displayName,
        region,
      })),
    };
  }

  @NotValueMoving(
    "Creates a session, like POST /api/auth/login: a retry mints a second, independently " +
      "revocable session for the same demo account and moves no value.",
  )
  @RateLimit({ ...LOGIN_RATE_LIMIT, routeId: "auth.demo_sign_in" })
  @Authorize({ kind: "session", action: "create" })
  @Post()
  async signIn(@Body() body: DemoSignInDto) {
    this.assertStaging();
    // Normalised here too: the allow-list must not depend on the global pipe being wired.
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const credential = DEMO_EMAILS.has(email)
      ? await this.credentials.findByKindAndIdentifier(PASSWORD_CREDENTIAL_KIND, email)
      : null;
    if (credential === null) {
      throw new ForbiddenException({
        code: "not_a_demo_account",
        message: "only the seeded demo accounts can sign in this way",
      });
    }
    // amr `demo`, never `pwd`: no password was checked (see session/amr.ts).
    return passwordSignInBody(
      await this.secondFactor.afterPassword(credential.userId, new Date(), DEMO_AMR),
    );
  }

  private assertStaging(): void {
    if (this.config.appEnv !== "staging") throw new NotFoundException();
  }
}
