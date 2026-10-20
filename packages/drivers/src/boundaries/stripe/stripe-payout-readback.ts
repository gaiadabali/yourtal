import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import type { BoundaryFailure } from "../../fault-engine";
import type {
  FindMoneyRequest,
  PayoutDetails,
  PayoutProgress,
  TransferDetails,
} from "../payout-accounts";
import { type StripeClient, stripePath, unexpectedAnswer } from "./stripe-client";
import { currencyFromStripe, fromStripeAmount } from "./stripe-money";
import { type StripeObject, asObject, int, obj, str } from "./stripe-object";

/** Reading payouts and transfers back from Stripe: by id, and by the reference we sent when the answer was lost. */

const BOUNDARY = "disbursement";
const PAGE_SIZE = 100;
/** 1,000 objects since `since`; past that the scan is cut short and cannot say "nothing found". */
const MAX_PAGES = 10;

function progressOf(
  payout: StripeObject,
): { status: PayoutProgress; failureCode: string | null } | undefined {
  switch (str(payout, "status")) {
    case "paid":
      return { status: "paid", failureCode: null };
    case "pending":
    case "in_transit":
      return { status: "pending", failureCode: null };
    case "failed":
      return { status: "failed", failureCode: str(payout, "failure_code") ?? "payout_failed" };
    case "canceled":
      return { status: "failed", failureCode: "canceled" };
    default:
      return undefined;
  }
}

function amountOf(
  object: StripeObject,
  what: string,
): Result<{ amountMinor: number; currency: Currency }, BoundaryFailure> {
  const currency = currencyFromStripe(str(object, "currency"));
  const amount = int(object, "amount");
  if (currency === undefined)
    return err(unexpectedAnswer(BOUNDARY, `Stripe answered a ${what} in an unknown currency.`));
  const amountMinor = amount === undefined ? undefined : fromStripeAmount(amount, currency);
  return amountMinor === undefined
    ? err(unexpectedAnswer(BOUNDARY, `Stripe answered a ${what} without a usable amount.`))
    : ok({ amountMinor, currency });
}

function referenceOf(object: StripeObject): string | null {
  return str(obj(object, "metadata"), "reference") ?? null;
}

export function payoutDetails(payout: StripeObject): Result<PayoutDetails, BoundaryFailure> {
  const payoutRef = str(payout, "id");
  if (payoutRef === undefined)
    return err(unexpectedAnswer(BOUNDARY, "Stripe answered a payout without an id."));
  const progress = progressOf(payout);
  if (progress === undefined)
    return err(
      unexpectedAnswer(
        BOUNDARY,
        `Stripe answered payout ${payoutRef} with status ${str(payout, "status") ?? "none"}.`,
      ),
    );
  const amount = amountOf(payout, "payout");
  if (amount.isErr()) return err(amount.error);
  return ok({ payoutRef, ...progress, ...amount.value, reference: referenceOf(payout) });
}

export function transferDetails(transfer: StripeObject): Result<TransferDetails, BoundaryFailure> {
  const transferRef = str(transfer, "id");
  if (transferRef === undefined)
    return err(unexpectedAnswer(BOUNDARY, "Stripe answered a transfer without an id."));
  const amount = amountOf(transfer, "transfer");
  if (amount.isErr()) return err(amount.error);
  return ok({ transferRef, ...amount.value, reference: referenceOf(transfer) });
}

export async function getPayout(
  client: StripeClient,
  accountRef: string,
  payoutRef: string,
): Promise<Result<PayoutDetails, BoundaryFailure>> {
  const payout = await client.get(
    stripePath("payouts", payoutRef),
    {},
    { stripeAccount: accountRef },
  );
  return payout.isErr() ? err(payout.error) : payoutDetails(payout.value);
}

/** The first object whose metadata.reference matches, or null only after every page since `since` was read. */
async function scan(
  client: StripeClient,
  path: string,
  filters: Readonly<Record<string, string>>,
  stripeAccount: string | undefined,
  request: FindMoneyRequest,
): Promise<Result<StripeObject | null, BoundaryFailure>> {
  const created = { gte: Math.floor(request.since.getTime() / 1_000) };
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const list = await client.get(
      path,
      { ...filters, limit: PAGE_SIZE, created, starting_after: startingAfter },
      stripeAccount === undefined ? {} : { stripeAccount },
    );
    if (list.isErr()) return err(list.error);
    const data = list.value.data;
    if (!Array.isArray(data) || typeof list.value.has_more !== "boolean")
      return err(unexpectedAnswer(BOUNDARY, `Stripe answered ${path} without a list.`));
    const items = data.map(asObject);
    for (const item of items) {
      if (item !== undefined && referenceOf(item) === request.reference) return ok(item);
    }
    if (!list.value.has_more) return ok(null);
    startingAfter = str(items[items.length - 1], "id");
    if (startingAfter === undefined)
      return err(unexpectedAnswer(BOUNDARY, `Stripe paged ${path} with an object that has no id.`));
  }
  return err(
    unexpectedAnswer(
      BOUNDARY,
      `More than ${String(MAX_PAGES * PAGE_SIZE)} objects on ${path} since ${request.since.toISOString()}; the scan stopped before the end.`,
    ),
  );
}

export async function findPayout(
  client: StripeClient,
  request: FindMoneyRequest,
): Promise<Result<PayoutDetails | null, BoundaryFailure>> {
  const found = await scan(client, "/v1/payouts", {}, request.accountRef, request);
  if (found.isErr()) return err(found.error);
  return found.value === null ? ok(null) : payoutDetails(found.value);
}

export async function findTransfer(
  client: StripeClient,
  request: FindMoneyRequest,
): Promise<Result<TransferDetails | null, BoundaryFailure>> {
  const found = await scan(
    client,
    "/v1/transfers",
    { destination: request.accountRef },
    undefined,
    request,
  );
  if (found.isErr()) return err(found.error);
  return found.value === null ? ok(null) : transferDetails(found.value);
}
