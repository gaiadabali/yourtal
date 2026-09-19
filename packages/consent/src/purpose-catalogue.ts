import { z } from "zod";
import { jurisdictionCodeSchema } from "@yourtal/jurisdiction/jurisdiction-code";
import type { JurisdictionCode } from "@yourtal/jurisdiction/jurisdiction-code";
import { lawfulBasisSchema, processingPurposeSchema } from "./purpose";
import type { ProcessingPurpose } from "./purpose";

/**
 * What each purpose is, what makes it lawful, and where it is not lawful at
 * all. YT-0036.
 *
 * ## The field that matters most: `prohibitedIn`
 *
 * `docs/19` lists the belief *"with consent we can do anything"* as false,
 * and says why: **Australia's privacy reform introduces a "fair and
 * reasonable" test that applies REGARDLESS of consent. A use can be
 * consented to and still unlawful.**
 *
 * That single sentence decides the architecture of this package. If consent
 * were sufficient, this could be a lookup: find the record, return the flag.
 * It is not sufficient, so `prohibitedIn` is checked BEFORE any record is
 * read, and a granted consent cannot override it — see `consent-query.ts`.
 * A service that asks "did they consent?" and stops there will be wrong in
 * Australia, and wrong in the specific way a regulator looks for.
 *
 * `docs/03` §3.2 is the source: the reforms reach "all advertising directed
 * at individuals using their personal information", explicitly including
 * online behavioural advertising. `docs/03`'s own implication line says to
 * **build for the future rule, not today's**.
 *
 * ## `availableFromPhase`
 *
 * `docs/16` D3: targeting in Phase 1 is geo, age band and declared interest
 * only; purchase history arrives in Phase 2 with its own separate consent.
 * A purpose that is not yet available is denied even if someone has somehow
 * collected consent for it, because the phase gate is about whether we have
 * earned the right to use it — `docs/19` §"instrumentation, not exploitation".
 */
export const consentPhaseSchema = z.enum(["P1", "P2", "P3"]);
export type ConsentPhase = z.infer<typeof consentPhaseSchema>;

export const purposeDefinitionSchema = z
  .object({
    purpose: processingPurposeSchema,
    lawfulBasis: lawfulBasisSchema,
    /**
     * Plain-language, in the user's terms, stating the CONSEQUENCE rather
     * than the mechanism. `docs/12` §on Google's consent screen: naming the
     * API scope ("see and download your contacts") is the bad pattern; the
     * screen has to say what happens.
     */
    description: z.string().min(1),
    /**
     * Sensitive under PDP / Privacy Act — health, religion, financial
     * distress and anything that implies them. Stricter rules, and never
     * bundled with anything else.
     */
    sensitive: z.boolean(),
    /** Jurisdictions where this is unlawful EVEN WITH CONSENT. */
    prohibitedIn: z.array(jurisdictionCodeSchema),
    availableFromPhase: consentPhaseSchema,
  })
  .strict();

export type PurposeDefinition = z.infer<typeof purposeDefinitionSchema>;

const DEFINITIONS: readonly PurposeDefinition[] = [
  {
    purpose: "deliver_reward",
    lawfulBasis: "contract",
    description: "Give you the points and vouchers you earned, and let you spend them.",
    sensitive: false,
    prohibitedIn: [],
    availableFromPhase: "P1",
  },
  {
    purpose: "prevent_fraud",
    lawfulBasis: "legal_obligation",
    description: "Detect accounts farming rewards, so real users keep getting paid.",
    sensitive: false,
    prohibitedIn: [],
    availableFromPhase: "P1",
  },
  {
    purpose: "comply_with_law",
    lawfulBasis: "legal_obligation",
    description: "Keep records a regulator or tax authority can require us to produce.",
    sensitive: false,
    prohibitedIn: [],
    availableFromPhase: "P1",
  },
  {
    purpose: "contextual_advertising",
    lawfulBasis: "no_personal_data",
    description: "Show campaigns that match what you are watching, not who you are.",
    sensitive: false,
    prohibitedIn: [],
    availableFromPhase: "P1",
  },
  {
    purpose: "aggregate_product_analytics",
    lawfulBasis: "no_personal_data",
    description: "Count how many people finished a video, never which people.",
    sensitive: false,
    prohibitedIn: [],
    availableFromPhase: "P1",
  },
  {
    purpose: "declared_interest_targeting",
    lawfulBasis: "consent",
    description: "Use the interests you chose yourself to pick which campaigns you see.",
    sensitive: false,
    prohibitedIn: [],
    availableFromPhase: "P1",
  },
  {
    purpose: "behavioural_profiling",
    lawfulBasis: "consent",
    description:
      "Build a profile from what you watch and click, and use it to pick campaigns for you.",
    sensitive: false,
    // The central case of what AU's reform reaches: advertising directed at
    // an individual using their personal information. docs/03 §3.2 says
    // build for the future rule, so this is off in AU now, not later.
    prohibitedIn: ["AU"],
    availableFromPhase: "P2",
  },
  {
    purpose: "purchase_history_targeting",
    lawfulBasis: "consent",
    description:
      "Use what you actually bought, from snap-apps receipts, to pick campaigns for you.",
    // A pharmacy receipt implies health; a purchase pattern implies
    // pregnancy, religious observance or financial distress. docs/19.
    sensitive: true,
    prohibitedIn: ["AU"],
    availableFromPhase: "P2",
  },
  {
    purpose: "market_research_panel",
    lawfulBasis: "consent",
    description: "Sell your answers to research buyers, always as part of a group, never named.",
    sensitive: false,
    prohibitedIn: [],
    availableFromPhase: "P2",
  },
  {
    purpose: "marketing_communications",
    lawfulBasis: "consent",
    description: "Send you messages about new campaigns and offers you have not earned yet.",
    sensitive: false,
    prohibitedIn: [],
    availableFromPhase: "P1",
  },
  {
    purpose: "sister_app_profile_sharing",
    lawfulBasis: "consent",
    description: "Let an app you signed into with YourtalID see your profile and balance.",
    sensitive: false,
    prohibitedIn: [],
    availableFromPhase: "P1",
  },
];

/**
 * Built once, and validated on the way in. `policy-data.ts` in the
 * jurisdiction package does the same thing for the same reason: a typo in
 * our own checked-in literals should fail exactly like a bad dynamic
 * override would, rather than being trusted because we wrote it.
 */
const CATALOGUE: ReadonlyMap<ProcessingPurpose, PurposeDefinition> = new Map(
  DEFINITIONS.map((definition) => [
    purposeDefinitionSchema.parse(definition).purpose,
    purposeDefinitionSchema.parse(definition),
  ]),
);

/** Every purpose, for the consent screen and for DSAR enumeration. */
export const ALL_PURPOSES: readonly ProcessingPurpose[] = processingPurposeSchema.options;

/**
 * The definition for a purpose, or `undefined` if the string is not one.
 * Callers must treat `undefined` as deny — `consent-query.ts` does.
 */
export function definitionFor(purpose: string): PurposeDefinition | undefined {
  const parsed = processingPurposeSchema.safeParse(purpose);
  return parsed.success ? CATALOGUE.get(parsed.data) : undefined;
}

/** Whether this purpose is unlawful in this jurisdiction even with consent. */
export function isProhibitedIn(
  definition: PurposeDefinition,
  jurisdiction: JurisdictionCode,
): boolean {
  return definition.prohibitedIn.includes(jurisdiction);
}
