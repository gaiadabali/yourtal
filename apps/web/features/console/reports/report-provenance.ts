/**
 * Every number this zone shows is labelled by how it was actually
 * obtained. This file is the fixed vocabulary that labelling uses —
 * nothing in `features/console/reports/**` renders a number without
 * attaching one of these.
 *
 * Why this file exists at all (read before adding a metric):
 * docs/23-critique.md §1.0 confirmed four of the five attention/fraud
 * controls this platform assumed do not exist — Cloudflare Stream exposes
 * no per-session or per-segment data (and bills preload as delivery, so
 * "delivered" never meant "watched"), Wake Lock + Page Visibility are
 * defeated by two lines of JavaScript, Indonesian SIM/OTP identity costs
 * cents per account, and passkeys are $0 to fake at scale. docs/06 §4/§5
 * and docs/tasks/phase-minus-1-pilot.md YT-0004 draw the one conclusion
 * that survives that audit: client-side player telemetry is **honest
 * drop-off data**, not proof of attention, and a checkpoint-question
 * result is **evidence of comprehension**, not proof of watching either —
 * a farm that actually reads the video can answer a question honestly.
 *
 * There is deliberately no "verified" tier below. A business asking
 * "were these views verified?" gets an honest "no" from this vocabulary,
 * not a softened synonym for it.
 */
export const REPORT_PROVENANCE_LEVELS = [
  "measured",
  "self_reported",
  "inferred",
  "configured",
  "unavailable",
] as const;

export type ReportProvenance = (typeof REPORT_PROVENANCE_LEVELS)[number];

export const PROVENANCE_LABEL: Record<ReportProvenance, string> = {
  measured: "Measured",
  self_reported: "Self-reported",
  inferred: "Inferred",
  configured: "Configured",
  unavailable: "Not available",
};

export const PROVENANCE_EXPLANATION: Record<ReportProvenance, string> = {
  measured:
    "Read directly from a system of record — here, the redemption ledger. A real record of what happened, not a proxy for it. Still not proof anyone watched a video: a voucher's status says nothing about how it was earned.",
  self_reported:
    "Answered by the viewer themselves, at a checkpoint question. Evidence of comprehension, not proof of watching — a device farm that actually plays the video back can answer honestly too (docs/06 §5).",
  inferred:
    "Calculated from other measured facts by a documented rule, not observed directly. The rule is shown next to the number, not hidden behind it.",
  configured:
    "Describes what the business set up — question count, type, scoring rule — not a performance outcome. Shown so the reporting frame is legible even before a single performance number exists.",
  unavailable:
    "No contract or event log exists yet to produce this honestly. Shown as an explicit, named gap rather than a plausible-looking fabricated figure (docs/23-critique.md §1.0).",
};
