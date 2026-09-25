import type { ResultAsync } from "neverthrow";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
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

/**
 * TASKS.md 1.2.b. `VoucherError` is the SAME closed enum `ledger-internal`
 * uses (1.2.c) — one caller-facing vocabulary for both internal services.
 */
export type VoucherError = LedgerError;

export interface VoucherInternalClient {
  requestBatch(request: RequestBatchRequest): ResultAsync<Batch, VoucherError>;
  approveBatch(request: ApproveBatchRequest): ResultAsync<Batch, VoucherError>;

  reserve(request: ReserveRequest): ResultAsync<Reservation, VoucherError>;
  release(request: ReleaseRequest): ResultAsync<void, VoucherError>;
  activate(request: ActivateRequest): ResultAsync<Reservation, VoucherError>;
  reveal(request: RevealRequest): ResultAsync<RevealedCode, VoucherError>;
  qrToken(request: QrTokenRequest): ResultAsync<QrToken, VoucherError>;
  verifyQrToken(request: VerifyQrTokenRequest): ResultAsync<VerifyQrTokenResult, VoucherError>;

  listForUser(request: ListForUserRequest): ResultAsync<ListForUserResult, VoucherError>;
  get(request: GetVoucherRequest): ResultAsync<Reservation, VoucherError>;

  authorizeAsDevice(request: AuthorizeAsDeviceRequest): ResultAsync<Authorization, VoucherError>;
  captureAsDevice(request: CaptureAsDeviceRequest): ResultAsync<Capture, VoucherError>;

  setKillSwitch(request: SetKillSwitchRequest): ResultAsync<KillSwitch, VoucherError>;
  listKillSwitches(): ResultAsync<readonly KillSwitch[], VoucherError>;

  issueMerchantCredential(
    request: IssueMerchantCredentialRequest,
  ): ResultAsync<MerchantCredential, VoucherError>;
  rotate(request: RotateCredentialRequest): ResultAsync<MerchantCredential, VoucherError>;
  revoke(request: RevokeCredentialRequest): ResultAsync<void, VoucherError>;

  merchantCaptureStats(
    request: MerchantCaptureStatsRequest,
  ): ResultAsync<MerchantCaptureStats, VoucherError>;
}

export const VOUCHER_INTERNAL_CLIENT = Symbol("VOUCHER_INTERNAL_CLIENT");
