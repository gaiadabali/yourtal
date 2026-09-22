/**
 * The red lines whose crossing **voids** the YT-0012 counsel-substitution
 * risk acceptance, each paired with the policy field that enforces it.
 *
 * ## Why this list exists rather than two more assertions
 *
 * YT-0012 is signed on the premise that YourTal Points are a loyalty
 * currency and not e-money (`docs/24` ID-1 / ID-2). Two red lines are not
 * merely *protected by* that acceptance, they are the premises it rests on:
 *
 * - **#3** no cash withdrawal, in either market, until licensed
 * - **#4** no user purchase of points, ever
 *
 * Crossing either does not weaken the acceptance, it **removes the thing
 * being accepted** — the signature stops being valid at that moment.
 *
 * The YT-0011 audit found #3 enforced and configuration-proof while #4 was
 * enforced by nothing, which meant the acceptance could be voided
 * **silently**: nothing anywhere would signal that the register had stopped
 * being true. Fixing #4 alone would have left the next voiding condition to
 * be discovered the same way, so YT-0602's third criterion asks for the
 * **property** rather than the instance — hence a list something can
 * iterate, and a test that iterates it.
 *
 * ## Adding to this list is the point
 *
 * If a future decision makes some other red line a premise of the
 * acceptance, adding it here is what forces its enforcement to exist:
 * `field` is typed `keyof JurisdictionPolicy`, so an entry naming a field
 * that does not exist **fails to compile**, and the accompanying test
 * asserts every listed field is locked off in every jurisdiction.
 */

import type { JurisdictionPolicy } from "./policy-schema";

export interface VoidingRedLine {
  /** Its number in `docs/24` § Red lines. */
  readonly redLine: number;
  /** The prohibition, quoted, so this file can be read without the other. */
  readonly statement: string;
  /**
   * The policy field that enforces it. Typed against the policy, so
   * **deleting the field breaks the build here** rather than quietly
   * leaving this entry pointing at nothing.
   */
  readonly field: keyof JurisdictionPolicy;
  /**
   * Whether the prohibition is conditional. `#3` ends when a licensing
   * project ships; `#4` never ends. This is why they are typed differently
   * in the schema — `z.boolean()` against `z.literal(false)` — and the
   * distinction is recorded rather than left to be re-derived.
   */
  readonly conditional: boolean;
}

export const VOIDING_RED_LINES: readonly VoidingRedLine[] = [
  {
    redLine: 3,
    statement: "No cash withdrawal, in either market, until licensed.",
    field: "cashOutEnabled",
    conditional: true,
  },
  {
    redLine: 4,
    statement: "No user purchase of points. Ever.",
    field: "userPointPurchaseEnabled",
    conditional: false,
  },
];
