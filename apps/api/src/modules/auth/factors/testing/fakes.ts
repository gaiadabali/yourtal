import type { AppConfig } from "../../../../config/app-config";
import type { AuthMethod } from "../../session/amr";
import type { SessionIssuer } from "../../session/session-issuer";
import type {
  ThrottleLimits,
  ThrottleService,
  ThrottleVerdict,
} from "../../throttle/throttle.service";

export const TEST_RP_ID = "yourtal.test";
export const TEST_ORIGIN = "https://yourtal.test";

export const FACTORS_CONFIG = {
  authFactors: {
    rpId: TEST_RP_ID,
    rpName: "YourTal",
    origins: [TEST_ORIGIN],
    totpSecretKey: "test-only-totp-secret-encryption-key-not-real",
  },
} as unknown as AppConfig;

/** Records every session it would have issued, with its `amr`. */
export class RecordingSessionIssuer {
  readonly issued: { userId: string; amr: readonly AuthMethod[] }[] = [];

  issue(userId: string, _now: Date, amr: readonly AuthMethod[]): Promise<string> {
    this.issued.push({ userId, amr });
    return Promise.resolve(`session-${String(this.issued.length)}`);
  }

  asIssuer(): SessionIssuer {
    return this as unknown as SessionIssuer;
  }
}

/** `ThrottleService`'s counting, without Valkey. */
export class InMemoryThrottle {
  private readonly counts = new Map<string, number>();

  peek(scope: string, key: string, limits: ThrottleLimits): Promise<ThrottleVerdict> {
    const count = this.counts.get(`${scope}:${key}`) ?? 0;
    return Promise.resolve(
      count >= limits.maxAttempts
        ? { blocked: true, retryAfterSeconds: limits.windowSeconds }
        : { blocked: false },
    );
  }

  reserve(scope: string, key: string, limits: ThrottleLimits): Promise<ThrottleVerdict> {
    const name = `${scope}:${key}`;
    const count = (this.counts.get(name) ?? 0) + 1;
    this.counts.set(name, count);
    return Promise.resolve(
      count > limits.maxAttempts
        ? { blocked: true, retryAfterSeconds: limits.windowSeconds }
        : { blocked: false },
    );
  }

  recordFailure(scope: string, key: string): Promise<void> {
    const name = `${scope}:${key}`;
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    return Promise.resolve();
  }

  reset(scope: string, key: string): Promise<void> {
    this.counts.delete(`${scope}:${key}`);
    return Promise.resolve();
  }

  asThrottle(): ThrottleService {
    return this as unknown as ThrottleService;
  }
}
