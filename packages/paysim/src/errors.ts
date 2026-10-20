/** Stripe's error envelope, thrown from handlers and rendered by the router. */
export interface StripeErrorBody {
  error: {
    type: string;
    message: string;
    code?: string;
    decline_code?: string;
    param?: string;
  };
}

export class StripeError extends Error {
  readonly status: number;
  readonly body: StripeErrorBody;

  constructor(status: number, error: StripeErrorBody["error"]) {
    super(error.message);
    this.status = status;
    this.body = { error };
  }
}

interface Extras {
  code?: string;
  param?: string;
}

function build(status: number, type: string, message: string, extras: Extras = {}): StripeError {
  return new StripeError(status, {
    type,
    message,
    ...(extras.code === undefined ? {} : { code: extras.code }),
    ...(extras.param === undefined ? {} : { param: extras.param }),
  });
}

export function invalidRequest(message: string, extras: Extras = {}): StripeError {
  return build(400, "invalid_request_error", message, extras);
}

export function missingParam(param: string): StripeError {
  return invalidRequest(`Missing required param: ${param}.`, { code: "parameter_missing", param });
}

export function invalidInteger(param: string, value: string): StripeError {
  return invalidRequest(`Invalid integer: ${value.slice(0, 40)}`, {
    code: "parameter_invalid_integer",
    param,
  });
}

export function invalidEnum(param: string, allowed: readonly string[]): StripeError {
  return invalidRequest(`Invalid ${param}: must be one of ${allowed.join(", ")}`, {
    code: "parameter_invalid_enum",
    param,
  });
}

export function resourceMissing(label: string, id: string, param?: string): StripeError {
  return build(404, "invalid_request_error", `No such ${label}: '${id.slice(0, 80)}'`, {
    code: "resource_missing",
    ...(param === undefined ? {} : { param }),
  });
}

export function amountTooSmall(message: string, param: string): StripeError {
  return invalidRequest(message, { code: "amount_too_small", param });
}

export function unexpectedState(message: string): StripeError {
  return invalidRequest(message, { code: "payment_intent_unexpected_state" });
}

export function cardDeclined(): StripeError {
  return new StripeError(402, {
    type: "card_error",
    code: "card_declined",
    decline_code: "generic_decline",
    message: "Your card was declined.",
  });
}

/** `sk_test_****abcd`: never echo more of a key than Stripe does. */
function maskKey(key: string): string {
  const m = /^(sk_(?:test|live)_)(.*)$/.exec(key);
  const rest = m?.[2] ?? key;
  const tail = rest.slice(-4);
  return `${m?.[1] ?? ""}****${tail}`;
}

export function invalidApiKey(provided: string | null): StripeError {
  if (provided === null || provided === "") {
    return build(
      401,
      "invalid_request_error",
      "You did not provide an API key. You need to provide your API key in the Authorization header, using Bearer auth (e.g. 'Authorization: Bearer YOUR_SECRET_KEY').",
    );
  }
  return build(401, "invalid_request_error", `Invalid API Key provided: ${maskKey(provided)}`);
}

export function idempotencyMismatch(key: string): StripeError {
  return build(
    400,
    "idempotency_error",
    `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${key.slice(0, 80)}' if you meant to execute a different request.`,
  );
}

export function unrecognizedUrl(method: string, path: string): StripeError {
  return build(
    404,
    "invalid_request_error",
    `Unrecognized request URL (${method}: ${path.slice(0, 120)}). Please see https://stripe.com/docs or we can help at https://support.stripe.com/.`,
  );
}
