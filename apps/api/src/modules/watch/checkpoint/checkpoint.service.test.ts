import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { Logger } from "@nestjs/common";
import { CHECKPOINT_TOKEN_TTL_MS } from "@yourtal/contracts/watch/checkpoint-token";
import { CheckpointService } from "./checkpoint.service";
import type {
  CheckpointNonceRepository,
  CheckpointSpend,
  SpendRefusal,
} from "./persistence/checkpoint-nonce.repository";

/**
 * `CheckpointService`'s orchestration. YT-0121.
 *
 * ## Why a fake repository is legitimate here, and where the real one is proved
 *
 * The house rule is that a fallback is the thing tests quietly select, and
 * `env.schema.ts` records what that cost when `DATABASE_URL` was optional —
 * the whole backend ran without executing a line of SQL. So a fake store
 * needs a reason.
 *
 * The reason is that this file tests something the database cannot answer:
 * the ORDER of verification and burning, and what happens to the store when
 * verification fails. The atomicity of the burn itself is NOT tested here
 * and must not be — it is proved in
 * `packages/db/src/checkpoint-nonce-constraints.test.ts`, against real
 * Postgres, including a concurrent double-spend where exactly one INSERT
 * survives and a deliberately unconstrained control table where both do.
 *
 * The fake below therefore models the two UNIQUE constraints exactly and
 * claims nothing about races. If it ever grows a concurrency test, that test
 * is proving a `Map` and belongs in the other file.
 */
class FakeNonceRepository implements CheckpointNonceRepository {
  readonly spent = new Map<string, CheckpointSpend>();
  private readonly answered = new Set<string>();

  spend(spend: CheckpointSpend): Promise<SpendRefusal | null> {
    if (this.spent.has(spend.nonce)) return Promise.resolve("nonce_already_spent");
    const checkpoint = `${spend.sessionId}:${String(spend.checkpointIndex)}`;
    if (this.answered.has(checkpoint)) return Promise.resolve("checkpoint_already_answered");

    this.spent.set(spend.nonce, spend);
    this.answered.add(checkpoint);
    return Promise.resolve(null);
  }

  prune(now: Date): Promise<number> {
    let removed = 0;
    for (const [nonce, spend] of this.spent) {
      if (spend.expiresAt < now) {
        this.spent.delete(nonce);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}

const SECRET = "test-secret-not-a-real-one";
const NOW = 1_764_000_000_000;

let nonces: FakeNonceRepository;
let service: CheckpointService;
let sessionId: string;

beforeEach(() => {
  nonces = new FakeNonceRepository();
  service = new CheckpointService(nonces, SECRET);
  sessionId = randomUUID();
});

describe("issuing", () => {
  it("issues a token that redeems once", async () => {
    const { token } = service.issue(sessionId, 0, NOW);

    const result = await service.redeem({ token, sessionId, checkpointIndex: 0, nowMs: NOW });
    expect(result.redeemed).toBe(true);
  });

  it("expires a token after the TTL", async () => {
    const { token, expiresAtMs } = service.issue(sessionId, 0, NOW);
    expect(expiresAtMs).toBe(NOW + CHECKPOINT_TOKEN_TTL_MS);

    const result = await service.redeem({
      token,
      sessionId,
      checkpointIndex: 0,
      nowMs: expiresAtMs + 1,
    });
    expect(result).toMatchObject({ redeemed: false, refusal: { kind: "token_rejected" } });
  });

  it("gives every issuance its own nonce", () => {
    const first = service.issue(sessionId, 0, NOW).token;
    const second = service.issue(sessionId, 0, NOW).token;

    // Same session, same checkpoint, same instant — and still different
    // bytes, because the nonce is fresh each time. This is exactly why the
    // nonce alone cannot enforce one-answer-per-checkpoint.
    expect(first).not.toBe(second);
  });
});

describe("redeeming", () => {
  it("refuses the same token twice", async () => {
    const { token } = service.issue(sessionId, 0, NOW);
    const input = { token, sessionId, checkpointIndex: 0, nowMs: NOW };

    expect((await service.redeem(input)).redeemed).toBe(true);
    expect(await service.redeem(input)).toMatchObject({
      redeemed: false,
      refusal: { kind: "nonce_already_spent" },
    });
  });

  it("refuses a second, freshly-signed token for a checkpoint already answered", async () => {
    // The attack nonce uniqueness does not cover: ask twice, spend both.
    // Both tokens are genuinely ours and individually valid.
    const first = service.issue(sessionId, 3, NOW).token;
    const second = service.issue(sessionId, 3, NOW).token;

    expect(
      (await service.redeem({ token: first, sessionId, checkpointIndex: 3, nowMs: NOW })).redeemed,
    ).toBe(true);
    expect(
      await service.redeem({ token: second, sessionId, checkpointIndex: 3, nowMs: NOW }),
    ).toMatchObject({ redeemed: false, refusal: { kind: "checkpoint_already_answered" } });
  });

  it("refuses a token minted for another session", async () => {
    const { token } = service.issue(randomUUID(), 0, NOW);

    expect(
      await service.redeem({ token, sessionId, checkpointIndex: 0, nowMs: NOW }),
    ).toMatchObject({ redeemed: false, refusal: { kind: "token_rejected" } });
  });

  /**
   * The ordering test, and the reason `verify` is not public.
   *
   * Burning before verifying would let anyone invalidate a checkpoint by
   * presenting garbage for it — a denial of service costing one request,
   * against the thing standing between a viewer and their reward. Nothing
   * about a rejected token may reach the store.
   */
  it("spends nothing when the token is rejected", async () => {
    await service.redeem({ token: "not-a-token", sessionId, checkpointIndex: 0, nowMs: NOW });
    await service.redeem({
      token: service.issue(sessionId, 0, NOW).token,
      sessionId,
      checkpointIndex: 0,
      nowMs: NOW + CHECKPOINT_TOKEN_TTL_MS + 1,
    });
    await service.redeem({
      token: service.issue(randomUUID(), 0, NOW).token,
      sessionId,
      checkpointIndex: 0,
      nowMs: NOW,
    });

    expect(nonces.spent.size).toBe(0);

    // And the checkpoint is still answerable, which is the point — three
    // hostile requests left the viewer's own token working.
    const { token } = service.issue(sessionId, 0, NOW);
    expect(
      (await service.redeem({ token, sessionId, checkpointIndex: 0, nowMs: NOW })).redeemed,
    ).toBe(true);
  });

  it("records the token's own expiry on the spend, so pruning has something true to read", async () => {
    const { token, expiresAtMs } = service.issue(sessionId, 0, NOW);
    await service.redeem({ token, sessionId, checkpointIndex: 0, nowMs: NOW });

    const [spend] = [...nonces.spent.values()];
    expect(spend?.expiresAt.getTime()).toBe(expiresAtMs);
  });
});

describe("logging refusals", () => {
  /**
   * AC3's second half: *rejected **and logged***.
   *
   * These assert the log because the log is the only place the distinction
   * the caller is denied survives. The HTTP boundary collapses every refusal
   * into one message so it cannot be used to probe (YT-0153) — that protects
   * the client side and destroys the evidence, so a fraud review depends
   * entirely on these lines existing.
   */
  let warn: MockInstance<(message: unknown, ...rest: unknown[]) => void>;
  let info: MockInstance<(message: unknown, ...rest: unknown[]) => void>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    info = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("distinguishes a replay from a second issuance, which the caller cannot", async () => {
    const { token } = service.issue(sessionId, 0, NOW);
    const input = { token, sessionId, checkpointIndex: 0, nowMs: NOW };
    await service.redeem(input);

    await service.redeem(input);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nonce_already_spent"));

    warn.mockClear();
    await service.redeem({
      token: service.issue(sessionId, 0, NOW).token,
      sessionId,
      checkpointIndex: 0,
      nowMs: NOW,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("checkpoint_already_answered"));
  });

  it("names the session and checkpoint, so a log line locates the attempt", async () => {
    await service.redeem({ token: "not-a-token", sessionId, checkpointIndex: 7, nowMs: NOW });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`session=${sessionId} checkpoint=7`),
    );
  });

  it("records a bad signature as a warning, not as routine", async () => {
    const stranger = new CheckpointService(new FakeNonceRepository(), "a-different-secret");
    const forged = stranger.issue(sessionId, 0, NOW).token;

    await service.redeem({ token: forged, sessionId, checkpointIndex: 0, nowMs: NOW });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bad_signature"));
  });

  /**
   * An expired token is what an honest viewer's idle tab produces. If it
   * warned, it would be the loudest line in the log and mean nothing — and a
   * signal that fires constantly is one nobody reads, which is how the real
   * ones get buried.
   */
  it("logs an expiry at info, never as a warning", async () => {
    const { token, expiresAtMs } = service.issue(sessionId, 0, NOW);
    await service.redeem({ token, sessionId, checkpointIndex: 0, nowMs: expiresAtMs + 1 });

    expect(info).toHaveBeenCalledWith(expect.stringContaining("expired"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("says nothing when a checkpoint is redeemed legitimately", async () => {
    const { token } = service.issue(sessionId, 0, NOW);
    await service.redeem({ token, sessionId, checkpointIndex: 0, nowMs: NOW });

    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});

describe("scheduling", () => {
  it("is deterministic per session and differs between sessions", () => {
    const mine = service.schedule(sessionId, 1_200, 4);

    expect(service.schedule(sessionId, 1_200, 4)).toEqual(mine);
    expect(service.schedule(randomUUID(), 1_200, 4)).not.toEqual(mine);
  });

  it("issues a redeemable token for every scheduled checkpoint", async () => {
    const times = service.schedule(sessionId, 1_200, 4);
    expect(times.length).toBeGreaterThan(0);

    for (const [index] of times.entries()) {
      const { token } = service.issue(sessionId, index, NOW);
      const result = await service.redeem({ token, sessionId, checkpointIndex: index, nowMs: NOW });
      expect(result.redeemed, `checkpoint ${String(index)} should redeem`).toBe(true);
    }
  });
});
