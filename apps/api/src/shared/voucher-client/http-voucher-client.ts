import { createHash, createHmac, randomUUID } from "node:crypto";
import { ResultAsync, err, ok } from "neverthrow";
import {
  ledgerError,
  ledgerErrorCodeSchema,
} from "@yourtal/contracts/ledger-internal/ledger-error";
import type {
  ApproveBatchRequest,
  Batch,
  RequestBatchRequest,
} from "@yourtal/contracts/voucher-internal/batches";
import type {
  ActivateRequest,
  QrToken,
  QrTokenRequest,
  ReleaseRequest,
  Reservation,
  ReserveRequest,
  RevealRequest,
  RevealedCode,
  VerifyQrTokenRequest,
  VerifyQrTokenResult,
  VoidVoucherRequest,
} from "@yourtal/contracts/voucher-internal/lifecycle";
import type {
  GetVoucherRequest,
  ListForUserRequest,
  ListForUserResult,
} from "@yourtal/contracts/voucher-internal/wallet";
import type {
  Authorization,
  AuthorizeAsDeviceRequest,
  Capture,
  CaptureAsDeviceRequest,
} from "@yourtal/contracts/voucher-internal/redemption";
import type {
  KillSwitch,
  SetKillSwitchRequest,
} from "@yourtal/contracts/voucher-internal/kill-switch";
import type {
  IssueMerchantCredentialRequest,
  MerchantCredential,
  RevokeCredentialRequest,
  RotateCredentialRequest,
} from "@yourtal/contracts/voucher-internal/credentials";
import type {
  MerchantCaptureStats,
  MerchantCaptureStatsRequest,
} from "@yourtal/contracts/voucher-internal/stats";
import type { VoucherError, VoucherInternalClient } from "./voucher-internal-client";

/** The services allowed to sign a voucher call (services/voucher/internal/serviceauth). */
export type VoucherCaller = "api" | "worker";

/**
 * The live voucher client (4.5). Every call is a POST to `/internal/v1`,
 * signed exactly the way `services/voucher/internal/serviceauth` verifies
 * it — HttpLedgerClient's own canonical string, copied rather than shared:
 * the two services are separate Go modules on purpose, and this client
 * mirrors that separation instead of threading one signer across both.
 *
 * A refusal the contract names comes back as the closed ledger-error code
 * (VoucherError = LedgerError, 1.2.c); anything else rejects, because it is
 * not a decision a caller can act on.
 */
export class HttpVoucherClient implements VoucherInternalClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly caller: VoucherCaller = "api",
  ) {}

  private sign(path: string, body: string): string {
    const t = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();
    const digest = createHash("sha256").update(body).digest("base64");
    const mac = createHmac("sha256", this.secret)
      .update([t, this.caller, nonce, "POST", path, digest].join("\n"))
      .digest("hex");
    return `t=${String(t)},c=${this.caller},n=${nonce},v1=${mac}`;
  }

  private async send(path: string, body: unknown): Promise<Response> {
    const payload = JSON.stringify(body);
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-yourtal-service-signature": this.sign(path, payload),
      },
      body: payload,
    });
  }

  private post<T>(path: string, body: unknown): ResultAsync<T, VoucherError> {
    return new ResultAsync(
      (async () => {
        const response = await this.send(path, body);
        if (response.ok) {
          return ok((await response.json()) as T);
        }
        const problem: unknown = await response.json().catch(() => null);
        const refusal =
          problem !== null && typeof problem === "object"
            ? (problem as Record<string, unknown>)
            : {};
        const code = ledgerErrorCodeSchema.safeParse(refusal["code"]);
        if (code.success) {
          const message = typeof refusal["message"] === "string" ? refusal["message"] : code.data;
          return err(ledgerError(code.data, message));
        }
        throw new Error(
          `voucher ${path} answered ${String(response.status)}: ${JSON.stringify(problem)}`,
        );
      })(),
    );
  }

  requestBatch(request: RequestBatchRequest): ResultAsync<Batch, VoucherError> {
    return this.post("/internal/v1/batches", request);
  }

  approveBatch(request: ApproveBatchRequest): ResultAsync<Batch, VoucherError> {
    return this.post("/internal/v1/batches/approve", request);
  }

  reserve(request: ReserveRequest): ResultAsync<Reservation, VoucherError> {
    return this.post("/internal/v1/reservations", request);
  }

  release(request: ReleaseRequest): ResultAsync<void, VoucherError> {
    return this.post("/internal/v1/reservations/release", request);
  }

  activate(request: ActivateRequest): ResultAsync<Reservation, VoucherError> {
    return this.post("/internal/v1/reservations/activate", request);
  }

  reveal(request: RevealRequest): ResultAsync<RevealedCode, VoucherError> {
    return this.post("/internal/v1/vouchers/reveal", request);
  }

  /** 4.7.c / K13 (requested by A). */
  voidVoucher(request: VoidVoucherRequest): ResultAsync<void, VoucherError> {
    return this.post("/internal/v1/vouchers/void", request);
  }

  /**
   * The wire response carries all twelve 5-minute-window tokens (4.5.b);
   * this narrower interface hands back only the current one. A widened
   * client is 8.x's to build when the wallet wants to cache the rest for
   * offline display — see the voucher service's own `qrTokenView` comment.
   */
  qrToken(request: QrTokenRequest): ResultAsync<QrToken, VoucherError> {
    return this.post("/internal/v1/vouchers/qr-token", request);
  }

  verifyQrToken(request: VerifyQrTokenRequest): ResultAsync<VerifyQrTokenResult, VoucherError> {
    return this.post("/internal/v1/vouchers/qr-token/verify", request);
  }

  listForUser(request: ListForUserRequest): ResultAsync<ListForUserResult, VoucherError> {
    return this.post("/internal/v1/wallet/list", request);
  }

  get(request: GetVoucherRequest): ResultAsync<Reservation, VoucherError> {
    return this.post("/internal/v1/wallet/get", request);
  }

  authorizeAsDevice(request: AuthorizeAsDeviceRequest): ResultAsync<Authorization, VoucherError> {
    return this.post("/internal/v1/device/authorize", request);
  }

  captureAsDevice(request: CaptureAsDeviceRequest): ResultAsync<Capture, VoucherError> {
    return this.post("/internal/v1/device/capture", request);
  }

  setKillSwitch(request: SetKillSwitchRequest): ResultAsync<KillSwitch, VoucherError> {
    return this.post("/internal/v1/kill-switches", request);
  }

  listKillSwitches(): ResultAsync<readonly KillSwitch[], VoucherError> {
    return this.post("/internal/v1/kill-switches/list", {});
  }

  issueMerchantCredential(
    request: IssueMerchantCredentialRequest,
  ): ResultAsync<MerchantCredential, VoucherError> {
    return this.post("/internal/v1/credentials", request);
  }

  rotate(request: RotateCredentialRequest): ResultAsync<MerchantCredential, VoucherError> {
    return this.post("/internal/v1/credentials/rotate", request);
  }

  revoke(request: RevokeCredentialRequest): ResultAsync<void, VoucherError> {
    return this.post("/internal/v1/credentials/revoke", request);
  }

  merchantCaptureStats(
    request: MerchantCaptureStatsRequest,
  ): ResultAsync<MerchantCaptureStats, VoucherError> {
    return this.post("/internal/v1/merchants/capture-stats", request);
  }
}
