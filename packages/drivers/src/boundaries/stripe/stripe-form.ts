/**
 * Stripe's bracket form encoding, the body format of every Stripe POST and the query format of every GET:
 * `metadata[reference]=x`, `line_items[0][price_data][unit_amount]=4500`, `expand[]=payment_intent`.
 *
 * Brackets are sent literally (as stripe-node does); keys and values are otherwise percent-encoded. Undefined is
 * omitted, null becomes an empty value (Stripe's way to unset a field), booleans are `true`/`false`. Arrays of
 * scalars are `key[]`, arrays of objects are indexed (`key[0][...]`).
 */

export type StripeScalar = string | number | boolean | null;
export type StripeParam =
  StripeScalar | undefined | readonly StripeParam[] | { readonly [key: string]: StripeParam };
export type StripeParams = Readonly<Record<string, StripeParam>>;

function encodePart(text: string): string {
  return encodeURIComponent(text).replace(/%5B/g, "[").replace(/%5D/g, "]");
}

function scalarText(value: StripeScalar): string {
  if (value === null) return "";
  if (typeof value === "number") {
    // A float in a money field is a bug upstream; never let one reach Stripe as "12.5".
    if (!Number.isFinite(value)) throw new Error("Stripe params cannot carry a non-finite number");
    return String(value);
  }
  return typeof value === "boolean" ? (value ? "true" : "false") : value;
}

function isScalar(value: StripeParam): value is StripeScalar {
  return value === null || typeof value !== "object";
}

function flatten(prefix: string, value: StripeParam, out: string[]): void {
  if (value === undefined) return;
  if (isScalar(value)) {
    out.push(`${encodePart(prefix)}=${encodePart(scalarText(value))}`);
    return;
  }
  if (Array.isArray(value)) {
    const items: readonly StripeParam[] = value;
    const indexed = items.some((item) => !isScalar(item ?? null));
    items.forEach((item, index) => {
      flatten(indexed ? `${prefix}[${String(index)}]` : `${prefix}[]`, item, out);
    });
    return;
  }
  for (const [key, child] of Object.entries(value as { readonly [key: string]: StripeParam })) {
    flatten(`${prefix}[${key}]`, child, out);
  }
}

export function encodeStripeForm(params: StripeParams): string {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) flatten(key, value, out);
  return out.join("&");
}
