import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { APP_CONFIG } from "../../../config/app-config.module";
import type { AppConfig } from "../../../config/app-config";
import {
  CREDENTIAL_REPOSITORY,
  PASSWORD_CREDENTIAL_KIND,
  TOTP_CREDENTIAL_KIND,
} from "../persistence/credential.repository";
import type { CredentialRepository } from "../persistence/credential.repository";
import { ThrottleService } from "../throttle/throttle.service";
import type { ThrottleLimits } from "../throttle/throttle.service";
import { ENROLMENT_TTL_SECONDS, FACTOR_WINDOW_MS } from "./factor-settings";
import { FACTOR_STORE } from "./factor-store";
import type { FactorStore } from "./factor-store";
import type { FactorError } from "./factor.errors";
import { openSecret, sealSecret } from "./sealed-secret";
import {
  TOTP_DRIFT_STEPS,
  TOTP_PERIOD_SECONDS,
  generateTotpSeed,
  matchTotpCode,
  totpUri,
} from "./totp-code";

/**
 * Wrong codes per account, across every route that takes one. Three codes are
 * valid at any moment (the drift window) out of a million, so five tries a
 * quarter hour leaves a guesser who already has the password about one chance
 * in 700 a day.
 */
export const TOTP_THROTTLE_LIMITS: ThrottleLimits = { maxAttempts: 5, windowSeconds: 15 * 60 };

/**
 * How long the last used step is remembered: longer than any step a code can
 * still match in, after which an older step is refused by the clock anyway.
 */
const USED_STEP_TTL_SECONDS = TOTP_PERIOD_SECONDS * (2 * TOTP_DRIFT_STEPS + 2);

type Outcome<T> = Promise<Result<T, FactorError>>;

/** Authenticator-app codes: enrol, confirm, check, and turn off. */
@Injectable()
export class TotpService implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(FACTOR_STORE) private readonly store: FactorStore,
    private readonly throttle: ThrottleService,
  ) {}

  /**
   * With no seed key, codes cannot be checked and accounts with an app would
   * fall back to the password alone. That is acceptable only while no account
   * has one, so outside dev the boot stops instead once any does.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.available() || this.config.appEnv === "dev") {
      return;
    }
    if (await this.credentials.anyVerified(TOTP_CREDENTIAL_KIND)) {
      throw new Error(
        "TOTP_SECRET_ENCRYPTION_KEY is unset but accounts have authenticator apps; set the key.",
      );
    }
  }

  /** False when this deployment has no seed key: authenticator apps are off. */
  available(): boolean {
    return this.config.authFactors?.totpSecretKey !== undefined;
  }

  async isEnabled(userId: string): Promise<boolean> {
    const credential = await this.credentials.findByUserAndKind(userId, TOTP_CREDENTIAL_KIND);
    return credential !== null && credential.verifiedAt !== null;
  }

  /**
   * Starts enrolment with a fresh seed. Nothing is written to the database:
   * the sealed seed waits in Valkey, tied to this session, for
   * `ENROLMENT_TTL_SECONDS`, and the app is switched on only by `confirm`.
   */
  async enrol(
    userId: string,
    sessionHash: string,
  ): Outcome<{ otpauthUri: string; secret: string }> {
    const key = this.config.authFactors?.totpSecretKey;
    if (key === undefined) return err({ type: "authenticator_unavailable" });
    if (await this.isEnabled(userId)) return err({ type: "totp_already_enabled" });

    const seed = generateTotpSeed();
    await this.store.putEnrolment(
      sessionHash,
      { userId, sealedSeed: sealSecret(seed, key, userId) },
      ENROLMENT_TTL_SECONDS,
    );
    const password = await this.credentials.findByUserAndKind(userId, PASSWORD_CREDENTIAL_KIND);
    return ok({ otpauthUri: totpUri(seed, password?.identifier ?? "YourTal"), secret: seed });
  }

  /**
   * Switches the app on with a first code, from the session that enrolled it
   * and within `ENROLMENT_TTL_SECONDS`.
   */
  async confirm(userId: string, sessionHash: string, code: string, now: Date): Outcome<void> {
    const enrolment = await this.store.readEnrolment(sessionHash);
    if (enrolment?.userId !== userId) return err({ type: "factor_invalid" });
    if (await this.isEnabled(userId)) return err({ type: "totp_already_enabled" });

    const checked = await this.check(userId, enrolment.sealedSeed, code, now);
    if (checked.isErr()) return err(checked.error);
    const written = await this.credentials.putVerified(
      {
        userId,
        kind: TOTP_CREDENTIAL_KIND,
        identifier: userId,
        secretHash: enrolment.sealedSeed,
        verifiedAt: now,
      },
      new Date(now.getTime() + FACTOR_WINDOW_MS),
    );
    await this.store.dropEnrolment(sessionHash);
    return written ? ok(undefined) : err({ type: "totp_already_enabled" });
  }

  /** Checks a code against a switched-on authenticator app. */
  async verify(userId: string, code: string, now: Date): Outcome<void> {
    const credential = await this.credentials.findByUserAndKind(userId, TOTP_CREDENTIAL_KIND);
    if (credential === null || credential.verifiedAt === null) {
      return err({ type: "factor_invalid" });
    }
    return this.check(userId, credential.secretHash, code, now);
  }

  /** Turns the app off. The caller has already proved a code or a passkey. */
  async remove(userId: string): Outcome<void> {
    const removed = await this.credentials.deleteByUserAndKind(userId, TOTP_CREDENTIAL_KIND);
    return removed ? ok(undefined) : err({ type: "totp_not_enabled" });
  }

  private async check(userId: string, sealed: string, code: string, now: Date): Outcome<void> {
    const key = this.config.authFactors?.totpSecretKey;
    if (key === undefined) return err({ type: "authenticator_unavailable" });

    // The attempt is counted before the code is looked at, so parallel
    // guesses cannot all slip in under the limit; a right code gives it back.
    const throttleKey = `totp:${userId}`;
    const verdict = await this.throttle.reserve("account", throttleKey, TOTP_THROTTLE_LIMITS);
    if (verdict.blocked) {
      return err({ type: "throttled", retryAfterSeconds: verdict.retryAfterSeconds ?? 900 });
    }

    const step = matchTotpCode(openSecret(sealed, key, userId), code, now);
    // Only a step later than the last one used is accepted (RFC 6238 §5.2):
    // a code read over someone's shoulder, or any earlier one, opens nothing.
    const fresh =
      step !== null && (await this.store.advanceTotpStep(userId, step, USED_STEP_TTL_SECONDS));
    if (!fresh) return err({ type: "factor_invalid" });
    await this.throttle.reset("account", throttleKey);
    return ok(undefined);
  }
}
