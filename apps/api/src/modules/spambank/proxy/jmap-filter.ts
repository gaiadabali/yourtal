import {
  ALLOWED_JMAP_CAPABILITIES,
  ALLOWED_JMAP_METHODS,
  MAX_RECIPIENTS_PER_SUBMISSION,
} from "@yourtal/contracts/spambank/mail";
import type { MailApiErrorCode } from "@yourtal/contracts/spambank/mail";

/**
 * The JMAP request filter of the mail proxy (spambank/BUILD.md §4.3). Pure: it reads the client's
 * request and either refuses the whole of it or returns the exact request to send upstream, plus the
 * recipients each submission would send to (for the daily cap).
 *
 * The proxy logs in to Stalwart as the token's own mailbox, so Stalwart already keeps one person out
 * of another's mail. This is the second wall, and the one that keeps a mail token from doing what
 * only the service may do (Sieve, identities, mailbox management, `x:` admin calls).
 */

const CAPABILITIES: ReadonlySet<string> = new Set(ALLOWED_JMAP_CAPABILITIES);
const METHODS: ReadonlySet<string> = new Set(ALLOWED_JMAP_METHODS);
/** Methods whose arguments are checked one by one, so a back-reference must not build them. */
const WRITE_METHODS: ReadonlySet<string> = new Set(["Email/set", "EmailSubmission/set"]);
/** A request is a few calls; this only bounds the work of checking one. */
const MAX_CALLS = 64;
const CALL_ID = /^[\x21-\x7e]{1,64}$/;
/** Header names that would let a client choose who a message claims to be from. */
const IDENTITY_HEADERS =
  /^header:(from|sender|resent-|return-path|received|dkim-|authentication-results|arc-)/i;

export interface FilterRefusal {
  readonly ok: false;
  readonly status: 400 | 403;
  readonly code: MailApiErrorCode;
  readonly message: string;
}

export interface FilteredRequest {
  readonly ok: true;
  /** The request to send upstream: `using` and `methodCalls` only. */
  readonly body: { using: string[]; methodCalls: [string, Record<string, unknown>, string][] };
  /** Recipients per submission creation id, per call id, for the daily cap and its refund. */
  readonly submissions: readonly Submission[];
  readonly recipients: number;
}

export interface Submission {
  readonly callId: string;
  readonly creationId: string;
  readonly recipients: number;
}

export interface FilterContext {
  /** The mailbox's own JMAP account id (from its upstream session). */
  readonly accountId: string;
  /** The mailbox's address. */
  readonly address: string;
}

function refuse(status: 400 | 403, code: MailApiErrorCode, message: string): FilterRefusal {
  return { ok: false, status, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameAddress(a: unknown, address: string): boolean {
  return typeof a === "string" && a.trim().toLowerCase() === address.toLowerCase();
}

/** True when `value` (any depth) carries a raw `headers` list or an identity `header:` property. */
function setsRawHeaders(value: unknown, depth = 0): boolean {
  if (depth > 16) return true;
  if (Array.isArray(value)) return value.some((item) => setsRawHeaders(item, depth + 1));
  if (!isRecord(value)) return false;
  for (const [key, inner] of Object.entries(value)) {
    if (key === "headers" || IDENTITY_HEADERS.test(key)) return true;
    if (setsRawHeaders(inner, depth + 1)) return true;
  }
  return false;
}

function checkEmailCreate(create: unknown, ctx: FilterContext): FilterRefusal | undefined {
  if (create === undefined || create === null) return undefined;
  if (!isRecord(create))
    return refuse(400, "invalid_request", "Email/set create must be an object.");
  for (const email of Object.values(create)) {
    if (!isRecord(email))
      return refuse(400, "invalid_request", "Each created Email must be an object.");
    if (email.sender !== undefined && email.sender !== null) {
      return refuse(400, "invalid_request", "A created Email may not set sender.");
    }
    if (email.from !== undefined && email.from !== null) {
      const from = email.from;
      if (
        !Array.isArray(from) ||
        from.length !== 1 ||
        !isRecord(from[0]) ||
        !sameAddress(from[0].email, ctx.address)
      ) {
        return refuse(400, "invalid_request", "from must be exactly the mailbox's own address.");
      }
    }
    if (setsRawHeaders(email)) {
      return refuse(400, "invalid_request", "A created Email may not set identity headers.");
    }
  }
  return undefined;
}

function checkSubmissions(
  args: Record<string, unknown>,
  callId: string,
  ctx: FilterContext,
  out: Submission[],
): FilterRefusal | undefined {
  const create = args.create;
  if (create === undefined || create === null) return undefined;
  if (!isRecord(create))
    return refuse(400, "invalid_request", "EmailSubmission/set create must be an object.");
  for (const [creationId, submission] of Object.entries(create)) {
    if (!isRecord(submission))
      return refuse(400, "invalid_request", "Each submission must be an object.");
    const envelope = submission.envelope;
    if (!isRecord(envelope) || !isRecord(envelope.mailFrom) || !Array.isArray(envelope.rcptTo)) {
      return refuse(400, "envelope_required", "A submission must carry an explicit envelope.");
    }
    if (!sameAddress(envelope.mailFrom.email, ctx.address)) {
      return refuse(
        400,
        "envelope_required",
        "The envelope's mailFrom must be the mailbox's own address.",
      );
    }
    const rcpt = envelope.rcptTo;
    if (
      rcpt.length === 0 ||
      !rcpt.every((r) => isRecord(r) && typeof r.email === "string" && r.email !== "")
    ) {
      return refuse(400, "envelope_required", "The envelope must name its recipients.");
    }
    if (rcpt.length > MAX_RECIPIENTS_PER_SUBMISSION) {
      return refuse(
        400,
        "too_many_recipients",
        `At most ${String(MAX_RECIPIENTS_PER_SUBMISSION)} recipients per message.`,
      );
    }
    out.push({ callId, creationId, recipients: rcpt.length });
  }
  return undefined;
}

/** Checks one call's arguments; pushes its submissions. */
function checkCall(
  name: string,
  args: Record<string, unknown>,
  callId: string,
  ctx: FilterContext,
  submissions: Submission[],
): FilterRefusal | undefined {
  for (const key of Object.keys(args)) {
    if (key.startsWith("#") && (WRITE_METHODS.has(name) || key === "#accountId")) {
      return refuse(
        400,
        "invalid_request",
        `${name} may not use a back-reference for ${key.slice(1)}.`,
      );
    }
  }
  if ("accountId" in args && args.accountId !== ctx.accountId) {
    return refuse(403, "not_allowed", "That account is not this mailbox.");
  }
  if (name === "Email/set") return checkEmailCreate(args.create, ctx);
  if (name === "EmailSubmission/set") return checkSubmissions(args, callId, ctx, submissions);
  return undefined;
}

/** Checks a client's JMAP request; see the file comment. */
export function filterJmapRequest(
  body: unknown,
  ctx: FilterContext,
): FilterRefusal | FilteredRequest {
  if (!isRecord(body) || !Array.isArray(body.using) || !Array.isArray(body.methodCalls)) {
    return refuse(400, "invalid_request", "Not a JMAP request.");
  }
  const using: string[] = [];
  for (const capability of body.using) {
    if (typeof capability !== "string" || !CAPABILITIES.has(capability)) {
      return refuse(400, "method_not_allowed", "A capability in using is not allowed.");
    }
    if (!using.includes(capability)) using.push(capability);
  }
  if (body.methodCalls.length === 0 || body.methodCalls.length > MAX_CALLS) {
    return refuse(400, "invalid_request", `A request has 1 to ${String(MAX_CALLS)} method calls.`);
  }
  const methodCalls: [string, Record<string, unknown>, string][] = [];
  for (const call of body.methodCalls) {
    if (
      !Array.isArray(call) ||
      call.length !== 3 ||
      typeof call[0] !== "string" ||
      !isRecord(call[1]) ||
      typeof call[2] !== "string" ||
      !CALL_ID.test(call[2])
    ) {
      return refuse(400, "invalid_request", "Each method call is [name, arguments, callId].");
    }
    methodCalls.push([call[0], call[1], call[2]]);
  }
  // Every name first: one forbidden method refuses the whole request, before anything else is read.
  for (const [name] of methodCalls) {
    if (!METHODS.has(name))
      return refuse(400, "method_not_allowed", `${name.slice(0, 60)} is not allowed.`);
  }
  const submissions: Submission[] = [];
  for (const [name, args, callId] of methodCalls) {
    const refusal = checkCall(name, args, callId, ctx, submissions);
    if (refusal !== undefined) return refusal;
  }
  const recipients = submissions.reduce((sum, s) => sum + s.recipients, 0);
  return { ok: true, body: { using, methodCalls }, submissions, recipients };
}

/**
 * Recipients of submissions Stalwart did not create (or of the whole request when its answer is
 * unreadable), so the daily count gives them back.
 */
export function unsentRecipients(submissions: readonly Submission[], response: unknown): number {
  if (submissions.length === 0) return 0;
  const all = submissions.reduce((sum, s) => sum + s.recipients, 0);
  if (!isRecord(response) || !Array.isArray(response.methodResponses)) return all;
  const answers: unknown[] = response.methodResponses;
  let unsent = 0;
  for (const submission of submissions) {
    let created: unknown;
    for (const answer of answers) {
      if (!Array.isArray(answer) || answer[2] !== submission.callId) continue;
      const result: unknown = answer[1];
      if (answer[0] === "EmailSubmission/set" && isRecord(result) && isRecord(result.created)) {
        created = result.created[submission.creationId];
      }
    }
    if (!isRecord(created)) unsent += submission.recipients;
  }
  return unsent;
}
