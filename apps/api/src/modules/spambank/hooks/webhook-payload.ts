/**
 * What the Stalwart webhook's body can tell us, read defensively (BUILD.md §5.4, U4). The payload's data
 * keys are not yet verified against a live delivery, and the reconcile makes the webhook non-critical, so
 * this never throws and never trusts a shape: it collects whatever looks like an account id or a recipient
 * address under the keys a delivery event plausibly uses, and the caller maps those to mailboxes (or falls
 * back to a reconcile when it can map none).
 */
export interface WebhookHints {
  /** Events whose type is a delivery (or has no type), after dropping the other kinds. */
  readonly relevantEvents: number;
  readonly ignoredEvents: number;
  readonly accountIds: readonly string[];
  /** Lower-case addresses. */
  readonly addresses: readonly string[];
  /** Key paths and value types only, never a value: safe to log when a shape is not understood. */
  readonly shape: string;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Event types that mean "a message was delivered to someone": `message-ingest.ham`, `delivery.delivered`, ... */
const RELEVANT_TYPE = /^(message-ingest|delivery)([.:_-]|$)/i;

const ACCOUNT_KEYS = new Set(["accountid", "account_id", "account", "accountname"]);
const ADDRESS_KEYS = new Set([
  "to",
  "rcpt",
  "rcptto",
  "recipient",
  "recipients",
  "deliveredto",
  "address",
  "email",
]);

const EMAIL = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const MAX_DEPTH = 5;
const MAX_ITEMS = 200;

function scalar(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Strings found anywhere under `value` (arrays, objects), bounded. */
function strings(value: unknown, depth = 0, out: string[] = []): string[] {
  if (out.length >= MAX_ITEMS || depth > MAX_DEPTH) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, depth + 1, out);
  else if (isRecord(value)) for (const item of Object.values(value)) strings(item, depth + 1, out);
  return out;
}

function collect(node: unknown, accounts: Set<string>, addresses: Set<string>, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, MAX_ITEMS)) collect(item, accounts, addresses, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const lower = key.toLowerCase();
    if (ACCOUNT_KEYS.has(lower)) {
      const id = scalar(value);
      if (id !== undefined && id.length <= 255) accounts.add(id);
    } else if (ADDRESS_KEYS.has(lower)) {
      for (const text of strings(value)) {
        for (const match of text.matchAll(EMAIL)) addresses.add(match[0].toLowerCase());
      }
    }
    if (typeof value === "object" && value !== null) collect(value, accounts, addresses, depth + 1);
  }
}

function shapeOf(node: unknown, depth = 0): string {
  if (Array.isArray(node))
    return depth >= 3 ? "[...]" : `[${node.length > 0 ? shapeOf(node[0], depth + 1) : ""}]`;
  if (isRecord(node)) {
    if (depth >= 3) return "{...}";
    const keys = Object.keys(node)
      .slice(0, 20)
      .map(
        (key) =>
          `${key.replace(/[^A-Za-z0-9_.:-]/g, "?").slice(0, 40)}:${shapeOf(node[key], depth + 1)}`,
      );
    return `{${keys.join(",")}}`;
  }
  return node === null ? "null" : typeof node;
}

/** The events in a body: `{events: [...]}`, a bare array, or one event object. */
function eventsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body.slice(0, MAX_ITEMS);
  if (isRecord(body)) {
    const events = body["events"];
    return Array.isArray(events) ? events.slice(0, MAX_ITEMS) : [body];
  }
  return [];
}

function typeOf(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  return scalar(event["type"]) ?? scalar(event["event"]) ?? scalar(event["name"]);
}

export function extractWebhookHints(body: unknown): WebhookHints {
  const accounts = new Set<string>();
  const addresses = new Set<string>();
  let relevant = 0;
  let ignored = 0;
  for (const event of eventsOf(body)) {
    const type = typeOf(event);
    if (type !== undefined && !RELEVANT_TYPE.test(type)) {
      ignored += 1;
      continue;
    }
    relevant += 1;
    collect(event, accounts, addresses);
  }
  return {
    relevantEvents: relevant,
    ignoredEvents: ignored,
    accountIds: [...accounts],
    addresses: [...addresses],
    shape: shapeOf(body),
  };
}
