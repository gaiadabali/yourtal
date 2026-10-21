import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { APP_CONFIG } from "../../../config/app-config.module";
import type { AppConfig } from "../../../config/app-config";
import {
  CREDENTIAL_REPOSITORY,
  PASSWORD_CREDENTIAL_KIND,
} from "../persistence/credential.repository";
import type { CredentialRepository } from "../persistence/credential.repository";
import { PASSKEY_REPOSITORY } from "../persistence/passkey.repository";
import type { PasskeyRepository, StoredPasskey } from "../persistence/passkey.repository";
import { CEREMONY_TTL_SECONDS } from "./factor-settings";
import type { AuthFactorSettings } from "./factor-settings";
import { FACTOR_STORE } from "./factor-store";
import type { FactorStore } from "./factor-store";
import type { FactorError } from "./factor.errors";

type Outcome<T> = Promise<Result<T, FactorError>>;

export interface PasskeyCeremony<T> {
  readonly challengeId: string;
  readonly options: T;
}

const DEFAULT_NAME = "Passkey";

/** What a registration challenge carries until the passkey is stored. */
interface PendingRegistration {
  readonly challenge: string;
  readonly handle: string;
}

/**
 * WebAuthn passkeys: register one while signed in, sign in with one (a
 * discoverable credential, so no email first), prove one again before a
 * sensitive change, list and remove. User verification (face, fingerprint,
 * screen lock) is required every time, which is what lets a passkey sign-in
 * stand on its own as `amr` hwk.
 *
 * Every challenge is single-use and expires after `CEREMONY_TTL_SECONDS`: it
 * is taken (read and deleted) before the response is checked, so a replayed
 * or a second answer to the same challenge finds nothing.
 */
@Injectable()
export class PasskeyService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PASSKEY_REPOSITORY) private readonly passkeys: PasskeyRepository,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(FACTOR_STORE) private readonly store: FactorStore,
  ) {}

  async registrationOptions(userId: string): Outcome<PublicKeyCredentialCreationOptionsJSON> {
    const settings = this.config.authFactors;
    if (settings === undefined) return err({ type: "factors_unavailable" });

    const [stored, existing, password] = await Promise.all([
      this.passkeys.userHandleOf(userId),
      this.passkeys.listForUser(userId),
      this.credentials.findByUserAndKind(userId, PASSWORD_CREDENTIAL_KIND),
    ]);
    // Nothing is written until a passkey is: a first one's handle rides with
    // the challenge and is stored with the passkey.
    const handle = stored ?? randomBytes(32).toString("base64url");
    const accountName = password?.identifier ?? "YourTal";
    const options = await generateRegistrationOptions({
      rpName: settings.rpName,
      rpID: settings.rpId,
      userName: accountName,
      userDisplayName: accountName,
      userID: new Uint8Array(Buffer.from(handle, "base64url")),
      attestationType: "none",
      timeout: CEREMONY_TTL_SECONDS * 1000,
      // The same authenticator twice would be one key under two names.
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: [...passkey.transports],
      })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const pending: PendingRegistration = { challenge: options.challenge, handle };
    await this.store.putChallenge(
      registrationKey(userId),
      JSON.stringify(pending),
      CEREMONY_TTL_SECONDS,
    );
    return ok(options);
  }

  async register(
    userId: string,
    response: RegistrationResponseJSON,
    name: string | undefined,
  ): Outcome<StoredPasskey> {
    const settings = this.config.authFactors;
    if (settings === undefined) return err({ type: "factors_unavailable" });
    const raw = await this.store.takeChallenge(registrationKey(userId));
    if (raw === null) return err({ type: "factor_invalid" });
    const pending = JSON.parse(raw) as PendingRegistration;

    const verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: [...settings.origins],
      expectedRPID: settings.rpId,
      requireUserVerification: true,
    }).catch(() => null);
    if (verified?.verified !== true) return err({ type: "factor_invalid" });

    const info = verified.registrationInfo;
    const passkey = {
      credentialId: info.credential.id,
      userId,
      publicKey: Buffer.from(info.credential.publicKey),
      signCount: info.credential.counter,
      transports: info.credential.transports ?? response.response.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      name: name ?? DEFAULT_NAME,
    };
    // Registered already, to this account or another: refused, never moved.
    if (!(await this.passkeys.create(passkey, pending.handle))) {
      return err({ type: "factor_invalid" });
    }
    const stored = await this.passkeys.findByCredentialId(passkey.credentialId);
    return stored === null ? err({ type: "factor_invalid" }) : ok(stored);
  }

  /** Options for signing in with any passkey for this site; no account named. */
  async signInOptions(): Outcome<PasskeyCeremony<PublicKeyCredentialRequestOptionsJSON>> {
    const settings = this.config.authFactors;
    if (settings === undefined) return err({ type: "factors_unavailable" });
    return ok(await this.ceremony(settings, signInKey, []));
  }

  /** The account a passkey sign-in proves, or `factor_invalid`. */
  async signIn(
    challengeId: string,
    response: AuthenticationResponseJSON,
    now: Date,
  ): Outcome<string> {
    const challenge = await this.store.takeChallenge(signInKey(challengeId));
    if (challenge === null) return err({ type: "factor_invalid" });
    return this.verifyAssertion(challenge, response, now, null);
  }

  /** Options to prove one of this account's own passkeys again (step-up). */
  async stepUpOptions(
    userId: string,
  ): Outcome<PasskeyCeremony<PublicKeyCredentialRequestOptionsJSON>> {
    const settings = this.config.authFactors;
    if (settings === undefined) return err({ type: "factors_unavailable" });
    const own = await this.passkeys.listForUser(userId);
    if (own.length === 0) return err({ type: "passkey_not_found" });
    return ok(await this.ceremony(settings, (id) => stepUpKey(userId, id), own));
  }

  async stepUp(
    userId: string,
    challengeId: string,
    response: AuthenticationResponseJSON,
    now: Date,
  ): Outcome<void> {
    const challenge = await this.store.takeChallenge(stepUpKey(userId, challengeId));
    if (challenge === null) return err({ type: "factor_invalid" });
    const proved = await this.verifyAssertion(challenge, response, now, userId);
    return proved.isOk() ? ok(undefined) : err(proved.error);
  }

  async list(userId: string): Promise<readonly StoredPasskey[]> {
    return this.passkeys.listForUser(userId);
  }

  async remove(userId: string, credentialId: string): Outcome<void> {
    const outcome = await this.passkeys.remove(userId, credentialId);
    if (outcome === "not_found") return err({ type: "passkey_not_found" });
    if (outcome === "last_sign_in_method") return err({ type: "last_sign_in_method" });
    return ok(undefined);
  }

  private async ceremony(
    settings: AuthFactorSettings,
    keyFor: (challengeId: string) => string,
    allow: readonly StoredPasskey[],
  ): Promise<PasskeyCeremony<PublicKeyCredentialRequestOptionsJSON>> {
    const challengeId = randomBytes(16).toString("base64url");
    const options = await generateAuthenticationOptions({
      rpID: settings.rpId,
      userVerification: "required",
      timeout: CEREMONY_TTL_SECONDS * 1000,
      allowCredentials: allow.map((passkey) => ({
        id: passkey.credentialId,
        transports: [...passkey.transports],
      })),
    });
    await this.store.putChallenge(keyFor(challengeId), options.challenge, CEREMONY_TTL_SECONDS);
    return { challengeId, options };
  }

  /** Checks an assertion against the stored key; `owner` set limits it to that account. */
  private async verifyAssertion(
    challenge: string,
    response: AuthenticationResponseJSON,
    now: Date,
    owner: string | null,
  ): Outcome<string> {
    const settings = this.config.authFactors;
    if (settings === undefined) return err({ type: "factors_unavailable" });
    const passkey = await this.passkeys.findByCredentialId(response.id);
    if (passkey === null || (owner !== null && passkey.userId !== owner)) {
      return err({ type: "factor_invalid" });
    }
    // The authenticator also names the account it holds the key for; it must agree.
    const handle = response.response.userHandle;
    if (handle !== undefined && (await this.passkeys.userIdForHandle(handle)) !== passkey.userId) {
      return err({ type: "factor_invalid" });
    }

    const verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: [...settings.origins],
      expectedRPID: settings.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.signCount,
        transports: [...passkey.transports],
      },
    }).catch(() => null);
    if (verified?.verified !== true) return err({ type: "factor_invalid" });

    // A counter another sign-in already moved past is a replay or a clone.
    const counted = await this.passkeys.recordUse(
      passkey.credentialId,
      verified.authenticationInfo.newCounter,
      now,
    );
    return counted ? ok(passkey.userId) : err({ type: "factor_invalid" });
  }
}

function registrationKey(userId: string): string {
  return `register:${userId}`;
}

function signInKey(challengeId: string): string {
  return `sign-in:${challengeId}`;
}

function stepUpKey(userId: string, challengeId: string): string {
  return `step-up:${userId}:${challengeId}`;
}
