import { err, ok } from "neverthrow";
import type { BoundaryFailure } from "../../fault-engine";
import type { Environment } from "../../driver-mode";
import { type MarketplacePaymentsDriver, releaseRequestOf } from "../marketplace-payments";
import {
  createStripeClient,
  stripeConfigFromEnv,
  stripePath,
  unexpectedAnswer,
} from "./stripe-client";
import {
  STRIPE_EXPONENTS,
  checkMinimumCharge,
  stripeCurrency,
  toStripeAmount,
} from "./stripe-money";
import { type StripeObject, idOf, int, obj, str } from "./stripe-object";

/**
 * Charity auction holds as Stripe destination charges (13.22, F86): a manual-capture PaymentIntent on the bidder's
 * saved card, with transfer_data.destination and on_behalf_of set to the charity's connected account, so the
 * captured money lands with the charity and never in a YourTal balance. Capture takes amount_to_capture; release
 * cancels the PaymentIntent.
 */

const BOUNDARY = "payments";

export interface StripeMarketplaceConfig {
  readonly apiBase?: string;
  readonly secretKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

function declined(detail: string): BoundaryFailure {
  return { kind: "declined", boundary: BOUNDARY, detail, mayHaveSucceeded: false };
}

function destinationOf(intent: StripeObject): string | undefined {
  return idOf(obj(intent, "transfer_data"), "destination");
}

export function createStripeMarketplacePayments(
  config: StripeMarketplaceConfig,
): MarketplacePaymentsDriver {
  const client = createStripeClient({ ...config, boundary: BOUNDARY });

  return {
    mode: "live",
    provider: "stripe",
    declaredMinorUnitExponent: STRIPE_EXPONENTS,
    needsSavedCard: true,

    async hold(request) {
      const { customerRef, paymentMethodRef, destinationReference } = request;
      if (customerRef === undefined || paymentMethodRef === undefined) {
        return err(
          declined(
            "A Stripe hold charges the bidder's saved card: customerRef and paymentMethodRef are required.",
          ),
        );
      }
      if (destinationReference === undefined || destinationReference.trim() === "") {
        return err(
          declined("A Stripe hold needs the charity's connected account as its destination."),
        );
      }
      const amount = toStripeAmount(BOUNDARY, request.amountMinor, request.currency).andThen(
        (value) =>
          checkMinimumCharge(BOUNDARY, request.amountMinor, request.currency).map(() => value),
      );
      if (amount.isErr()) return err(amount.error);

      const intent = await client.post(
        "/v1/payment_intents",
        {
          amount: amount.value,
          currency: stripeCurrency(request.currency),
          customer: customerRef,
          payment_method: paymentMethodRef,
          confirm: true,
          off_session: true,
          capture_method: "manual",
          transfer_data: { destination: destinationReference },
          on_behalf_of: destinationReference,
          metadata: { reference: request.reference },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      if (intent.isErr()) return err(intent.error);
      const holdReference = str(intent.value, "id");
      const status = str(intent.value, "status");
      if (holdReference === undefined)
        return err(unexpectedAnswer(BOUNDARY, "A PaymentIntent without an id."));
      if (status !== "requires_capture") {
        return err(
          declined(
            `The hold was not placed (PaymentIntent ${holdReference} is ${status ?? "unknown"}).`,
          ),
        );
      }
      return ok({
        holdReference,
        providerAmount: int(intent.value, "amount_capturable") ?? amount.value,
      });
    },

    async capture(request) {
      const amount = toStripeAmount(BOUNDARY, request.amountMinor, request.currency);
      if (amount.isErr()) return err(amount.error);
      const path = stripePath("payment_intents", request.holdReference);

      // Checked before capturing: money must never be captured towards an account the caller did not name.
      const current = await client.get(path);
      if (current.isErr()) return err(current.error);
      const heldFor = destinationOf(current.value);
      if (heldFor !== request.destinationReference) {
        return err(
          declined(
            `Hold ${request.holdReference} pays ${heldFor ?? "no account"}, not ${request.destinationReference}.`,
          ),
        );
      }

      const captured = await client.post(
        `${path}/capture`,
        { amount_to_capture: amount.value },
        { idempotencyKey: request.idempotencyKey },
      );
      if (captured.isErr()) return err(captured.error);
      const status = str(captured.value, "status");
      const paidTo = destinationOf(captured.value);
      if (status !== "succeeded" || paidTo !== request.destinationReference) {
        return err(
          unexpectedAnswer(
            BOUNDARY,
            `Capture of ${request.holdReference} answered ${status ?? "unknown"} towards ${paidTo ?? "no account"}.`,
          ),
        );
      }
      return ok({
        captureReference: request.holdReference,
        destinationReference: paidTo,
        providerAmount: int(captured.value, "amount_received") ?? amount.value,
      });
    },

    async release(input) {
      const request = releaseRequestOf(input);
      const path = stripePath("payment_intents", request.holdReference);
      const canceled = await client.post(
        `${path}/cancel`,
        {},
        { idempotencyKey: request.idempotencyKey },
      );
      if (canceled.isOk() || canceled.error.kind !== "declined")
        return canceled.map(() => undefined);
      // Stripe refuses to cancel a PaymentIntent twice; one already canceled (by us, or by the 7-day sweep) is released.
      const current = await client.get(path);
      return current.isOk() && str(current.value, "status") === "canceled"
        ? ok(undefined)
        : err(canceled.error);
    },
  };
}

export function createStripeMarketplaceFromEnv(
  env: Environment,
  fetchImpl?: typeof fetch,
): MarketplacePaymentsDriver {
  const config = stripeConfigFromEnv(env);
  return createStripeMarketplacePayments({
    apiBase: config.apiBase,
    secretKey: config.secretKey,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}
