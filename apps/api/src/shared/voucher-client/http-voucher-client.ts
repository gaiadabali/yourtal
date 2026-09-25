import { ResultAsync, err, ok } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
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
import type { KillSwitch, SetKillSwitchRequest } from "@yourtal/contracts/voucher-internal/kill-switch";
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

/** TASKS.md 1.2.d's HTTP half for `services/voucher` — see `HttpLedgerClient` for why this is forward plumbing, not yet exercised. */
export class HttpVoucherClient implements VoucherInternalClient {
  constructor(private readonly baseUrl: string) {}

  private post<T>(path: string, body: unknown): ResultAsync<T, VoucherError> {
    return new ResultAsync(
      (async () => {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const problem: unknown = await response.json().catch(() => null);
          const code =
            problem !== null && typeof problem === "object" && "code" in problem
              ? String((problem as Record<string, unknown>)["code"])
              : "unknown";
          return err(ledgerError("region_mismatch", `voucher service refused: ${code}`));
        }
        return ok((await response.json()) as T);
      })(),
    );
  }

  requestBatch(request: RequestBatchRequest): ResultAsync<Batch, VoucherError> {
    return this.post("/v1/batches", request);
  }

  approveBatch(request: ApproveBatchRequest): ResultAsync<Batch, VoucherError> {
    return this.post("/v1/batches/approve", request);
  }

  reserve(request: ReserveRequest): ResultAsync<Reservation, VoucherError> {
    return this.post("/v1/reservations", request);
  }

  release(request: ReleaseRequest): ResultAsync<void, VoucherError> {
    return this.post("/v1/reservations/release", request);
  }

  activate(request: ActivateRequest): ResultAsync<Reservation, VoucherError> {
    return this.post("/v1/reservations/activate", request);
  }

  reveal(request: RevealRequest): ResultAsync<RevealedCode, VoucherError> {
    return this.post("/v1/vouchers/reveal", request);
  }

  qrToken(request: QrTokenRequest): ResultAsync<QrToken, VoucherError> {
    return this.post("/v1/vouchers/qr-token", request);
  }

  verifyQrToken(request: VerifyQrTokenRequest): ResultAsync<VerifyQrTokenResult, VoucherError> {
    return this.post("/v1/vouchers/qr-token/verify", request);
  }

  listForUser(request: ListForUserRequest): ResultAsync<ListForUserResult, VoucherError> {
    return this.post("/v1/wallet/list", request);
  }

  get(request: GetVoucherRequest): ResultAsync<Reservation, VoucherError> {
    return this.post("/v1/wallet/get", request);
  }

  authorizeAsDevice(request: AuthorizeAsDeviceRequest): ResultAsync<Authorization, VoucherError> {
    return this.post("/v1/device/authorize", request);
  }

  captureAsDevice(request: CaptureAsDeviceRequest): ResultAsync<Capture, VoucherError> {
    return this.post("/v1/device/capture", request);
  }

  setKillSwitch(request: SetKillSwitchRequest): ResultAsync<KillSwitch, VoucherError> {
    return this.post("/v1/kill-switches", request);
  }

  listKillSwitches(): ResultAsync<readonly KillSwitch[], VoucherError> {
    return this.post("/v1/kill-switches/list", {});
  }

  issueMerchantCredential(
    request: IssueMerchantCredentialRequest,
  ): ResultAsync<MerchantCredential, VoucherError> {
    return this.post("/v1/credentials", request);
  }

  rotate(request: RotateCredentialRequest): ResultAsync<MerchantCredential, VoucherError> {
    return this.post("/v1/credentials/rotate", request);
  }

  revoke(request: RevokeCredentialRequest): ResultAsync<void, VoucherError> {
    return this.post("/v1/credentials/revoke", request);
  }

  merchantCaptureStats(
    request: MerchantCaptureStatsRequest,
  ): ResultAsync<MerchantCaptureStats, VoucherError> {
    return this.post("/v1/merchants/capture-stats", request);
  }
}
