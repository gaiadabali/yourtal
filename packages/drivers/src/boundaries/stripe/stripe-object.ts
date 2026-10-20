/** Typed reads from a parsed Stripe JSON object. Stripe answers are untrusted input, never cast wholesale. */

export type StripeObject = Readonly<Record<string, unknown>>;

export function asObject(value: unknown): StripeObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as StripeObject)
    : undefined;
}

export function str(object: StripeObject | undefined, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function int(object: StripeObject | undefined, key: string): number | undefined {
  const value = object?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function bool(object: StripeObject | undefined, key: string): boolean | undefined {
  const value = object?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function obj(object: StripeObject | undefined, key: string): StripeObject | undefined {
  return asObject(object?.[key]);
}

/** An expandable field: Stripe sends either the id or, when expanded, the object carrying it. */
export function idOf(object: StripeObject | undefined, key: string): string | undefined {
  return str(object, key) ?? str(obj(object, key), "id");
}

/** `external_accounts.data[0].last4`: the bank account a connected account pays out to. */
export function bankLast4(account: StripeObject | undefined): string | null {
  const data = obj(account, "external_accounts")?.data;
  const first = Array.isArray(data) ? asObject(data[0]) : undefined;
  return str(first, "last4") ?? null;
}
