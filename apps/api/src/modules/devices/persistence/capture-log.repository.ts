import type { Currency } from "@yourtal/contracts/money/currency";

export interface CaptureLogRow {
  readonly captureId: string;
  readonly deviceId: string;
  readonly businessId: string;
  readonly locationId: string;
  readonly voucherId: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly orderRef: string;
  readonly orderTotalMinor: number;
  /** The voucher's title at the time; `null` for rows logged before titles were kept. */
  readonly offerTitle: string | null;
  readonly authorizedAt: Date;
  readonly capturedAt: Date;
}

export type RecordCaptureInput = CaptureLogRow;

export interface CaptureLogQuery {
  readonly businessId: string;
  readonly locationId?: string;
  readonly deviceId?: string;
  readonly limit: number;
}

export interface CaptureLogRepository {
  /** Idempotent on `captureId` — a retried capture-log write after a lost response is a no-op, not a duplicate row. */
  record(input: RecordCaptureInput): Promise<void>;
  /**
   * Today's captures at one device, newest first — `redemption.yaml`'s
   * `logScope: "today"`. "Today" is a calendar day on the device's own
   * region clock (F16, `timeZone`), so a Sydney counter's list rolls over
   * at Sydney midnight, not at 11am when UTC does.
   */
  listTodayForDevice(deviceId: string, timeZone: string): Promise<readonly CaptureLogRow[]>;
  listForBusiness(query: CaptureLogQuery): Promise<readonly CaptureLogRow[]>;
}

export const CAPTURE_LOG_REPOSITORY = Symbol("CAPTURE_LOG_REPOSITORY");
