import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";

/**
 * Sourcing a redeemable code from a supplier at the moment of redemption.
 *
 * ## The boundary where a timeout costs real inventory
 *
 * Every other boundary's timeout risks a duplicate. This one risks a
 * **silently consumed** unit of stock: the supplier issued a code, we never
 * received it, and a retry buys a second. So `reserve` is idempotency-keyed
 * and the simulator answers a replay with the original code rather than
 * issuing another — which is what makes the `timeout` fault meaningful here
 * instead of decorative.
 *
 * Stock is finite in the simulator for the same reason. An infinite one
 * cannot produce `out_of_stock`, and a redemption path that has never seen
 * it will take a user's points and then discover there is nothing to give.
 */

export interface ReserveRequest {
  readonly idempotencyKey: string;
  readonly sku: string;
}

export interface ReservedGood {
  readonly redemptionCode: string;
  readonly sku: string;
}

export interface DigitalGoodsDriver {
  readonly mode: DriverMode;
  reserve(request: ReserveRequest): Promise<Result<ReservedGood, BoundaryFailure>>;
  remainingStock(sku: string): number;
}

export const SIMULATED_STOCK: Readonly<Record<string, number>> = {
  "pulsa-10k": 3,
  "voucher-coffee": 2,
  "sold-out-sku": 0,
};

export function createSimulatedDigitalGoods(faultPlan?: FaultPlan): DigitalGoodsDriver {
  const engine = new FaultEngine(faultPlan);
  const stock = new Map(Object.entries(SIMULATED_STOCK));
  const reserved = new Map<string, ReservedGood>();
  let issued = 0;

  return {
    mode: "simulated",

    reserve(request: ReserveRequest): Promise<Result<ReservedGood, BoundaryFailure>> {
      const replay = reserved.get(request.idempotencyKey);
      if (replay !== undefined) return Promise.resolve(ok(replay));

      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("digital_goods", directive)));
      }

      const remaining = stock.get(request.sku);
      if (remaining === undefined) {
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "digital_goods",
            detail: `Unknown sku "${request.sku}".`,
            mayHaveSucceeded: false,
          }),
        );
      }
      if (remaining <= 0) {
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "digital_goods",
            detail: `No stock remaining for "${request.sku}".`,
            mayHaveSucceeded: false,
          }),
        );
      }

      issued += 1;
      stock.set(request.sku, remaining - 1);
      const good: ReservedGood = {
        redemptionCode: `SIMCODE${String(issued).padStart(4, "0")}`,
        sku: request.sku,
      };
      reserved.set(request.idempotencyKey, good);
      return Promise.resolve(ok(good));
    },

    remainingStock(sku: string): number {
      return stock.get(sku) ?? 0;
    },
  };
}

export function createDigitalGoodsDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): DigitalGoodsDriver {
  return mode === "simulated"
    ? createSimulatedDigitalGoods(faultPlan)
    : refuseLiveDriver("digital_goods");
}
