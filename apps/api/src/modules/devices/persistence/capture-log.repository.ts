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
   * `logScope: "today"`. UTC calendar day, not yet the region clock F16
   * specifies for streaks — a known simplification, not a silent one: a
   * device near a region's midnight sees today's log roll over at UTC
   * midnight rather than its own local one.
   */
  listTodayForDevice(deviceId: string): Promise<readonly CaptureLogRow[]>;
  listForBusiness(query: CaptureLogQuery): Promise<readonly CaptureLogRow[]>;
}

export const CAPTURE_LOG_REPOSITORY = Symbol("CAPTURE_LOG_REPOSITORY");
