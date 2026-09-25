import type { ResultAsync } from "neverthrow";
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
import type { AppDb } from "../persistence/drizzle-client";
import type { VoucherError, VoucherInternalClient } from "./voucher-internal-client";
import * as batches from "./fake/fake-voucher-batches";
import * as lifecycle from "./fake/fake-voucher-lifecycle";
import * as walletOps from "./fake/fake-voucher-wallet";
import * as redemption from "./fake/fake-voucher-redemption";
import * as killSwitch from "./fake/fake-voucher-killswitch";
import * as credentials from "./fake/fake-voucher-credentials";
import * as stats from "./fake/fake-voucher-stats";

/** TASKS.md 1.2.d, `voucher-internal`'s half — see `FakeLedgerClient` for the shared design notes. */
export class FakeVoucherClient implements VoucherInternalClient {
  constructor(private readonly db: AppDb) {}

  requestBatch(request: RequestBatchRequest): ResultAsync<Batch, VoucherError> {
    return batches.requestBatch(this.db, request);
  }

  approveBatch(request: ApproveBatchRequest): ResultAsync<Batch, VoucherError> {
    return batches.approveBatch(this.db, request);
  }

  reserve(request: ReserveRequest): ResultAsync<Reservation, VoucherError> {
    return lifecycle.reserve(this.db, request);
  }

  release(request: ReleaseRequest): ResultAsync<void, VoucherError> {
    return lifecycle.release(this.db, request);
  }

  activate(request: ActivateRequest): ResultAsync<Reservation, VoucherError> {
    return lifecycle.activate(this.db, request);
  }

  reveal(request: RevealRequest): ResultAsync<RevealedCode, VoucherError> {
    return lifecycle.reveal(this.db, request);
  }

  qrToken(request: QrTokenRequest): ResultAsync<QrToken, VoucherError> {
    return lifecycle.qrToken(this.db, request);
  }

  verifyQrToken(request: VerifyQrTokenRequest): ResultAsync<VerifyQrTokenResult, VoucherError> {
    return lifecycle.verifyQrToken(this.db, request);
  }

  listForUser(request: ListForUserRequest): ResultAsync<ListForUserResult, VoucherError> {
    return walletOps.listForUser(this.db, request);
  }

  get(request: GetVoucherRequest): ResultAsync<Reservation, VoucherError> {
    return walletOps.get(this.db, request);
  }

  authorizeAsDevice(request: AuthorizeAsDeviceRequest): ResultAsync<Authorization, VoucherError> {
    return redemption.authorizeAsDevice(this.db, request);
  }

  captureAsDevice(request: CaptureAsDeviceRequest): ResultAsync<Capture, VoucherError> {
    return redemption.captureAsDevice(this.db, request);
  }

  setKillSwitch(request: SetKillSwitchRequest): ResultAsync<KillSwitch, VoucherError> {
    return killSwitch.setKillSwitch(this.db, request);
  }

  listKillSwitches(): ResultAsync<readonly KillSwitch[], VoucherError> {
    return killSwitch.listKillSwitches(this.db);
  }

  issueMerchantCredential(
    request: IssueMerchantCredentialRequest,
  ): ResultAsync<MerchantCredential, VoucherError> {
    return credentials.issueMerchantCredential(this.db, request);
  }

  rotate(request: RotateCredentialRequest): ResultAsync<MerchantCredential, VoucherError> {
    return credentials.rotate(this.db, request);
  }

  revoke(request: RevokeCredentialRequest): ResultAsync<void, VoucherError> {
    return credentials.revoke(this.db, request);
  }

  merchantCaptureStats(
    request: MerchantCaptureStatsRequest,
  ): ResultAsync<MerchantCaptureStats, VoucherError> {
    return stats.merchantCaptureStats(this.db, request);
  }
}
