import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import type { Principal } from "@yourtal/authz/principal";
import { audienceSchema, reachesAudience } from "@yourtal/contracts/audience/audience";
import type { Audience, AgeBand } from "@yourtal/contracts/audience/audience";

/**
 * 12.1.b's parity proof: `reachesAudience` (the TS truth every list path
 * derives from -- `reachableAudiences`, `catalogue-scope.ts`,
 * `quote-checkout.ts`) and `campaign_view.yaml`/`listing.yaml`'s own
 * `audience-wall`/`consumer-browse-is-audience-gated` DENY rules answer the
 * SAME question for every `ageBand` x `guardianConsent` x `audience`
 * combination. A per-resource Cerbos check cannot filter a LIST, which is
 * exactly why every list path has its own TS-side helper instead of asking
 * Cerbos per item -- this suite is what proves that helper and the policy
 * repo have not drifted apart, against a REAL Cerbos (this worktree's own,
 * mounting this worktree's `policies/` -- never the shared `yourtal-cerbos`
 * on 26592, which would prove parity against whatever policy last merged,
 * not what this branch is about to ship).
 *
 * Run with `.env` sourced, same as `session-and-region-wall.check.e2e.test.ts`.
 */
const pdp = createPdpClient({ baseUrl: process.env["PDP_BASE_URL"] ?? "http://127.0.0.1:26615" });

const AGE_BANDS: readonly (AgeBand | undefined)[] = [undefined, "teen", "adult"];
const GUARDIAN_CONSENTS: readonly (Principal["attr"]["guardianConsent"] | undefined)[] = [
  undefined,
  "not_required",
  "pending",
  "granted",
  "revoked",
];
const AUDIENCES: readonly Audience[] = audienceSchema.options;

function principalFor(
  ageBand: AgeBand | undefined,
  guardianConsent: string | undefined,
): Principal {
  return {
    id: `parity-${randomUUID()}`,
    roles: ["user"],
    attr: {
      jurisdiction: "ID",
      businessRoles: {},
      isSuspended: false,
      ...(ageBand === undefined ? {} : { ageBand }),
      ...(guardianConsent === undefined
        ? {}
        : { guardianConsent: guardianConsent as Principal["attr"]["guardianConsent"] }),
    },
  };
}

/** The teen-earns-only-with-guardian-consent truth table, restated here so the test does not import the rule it is proving. */
function canEarn(ageBand: AgeBand | undefined, guardianConsent: string | undefined): boolean {
  if (ageBand !== "teen") return true;
  return guardianConsent === "granted";
}

describe("12.1.b parity: campaign_view's audience-wall + guardian-consent rules vs reachesAudience", () => {
  for (const ageBand of AGE_BANDS) {
    for (const guardianConsent of GUARDIAN_CONSENTS) {
      for (const audience of AUDIENCES) {
        it(`ageBand=${ageBand ?? "none"} guardianConsent=${guardianConsent ?? "none"} audience=${audience}`, async () => {
          const principal = principalFor(ageBand, guardianConsent);
          // `reachesAudience` requires a real ageBand; the policy's own
          // fail-closed behaviour for a MISSING one is "all_ages only" --
          // restated here as the expectation, not imported, for the same
          // reason `canEarn` above is restated.
          const expectedWatchOpen =
            ageBand === undefined
              ? audience === "all_ages"
              : reachesAudience(audience, { ageBand });
          const expectedEarn = expectedWatchOpen && canEarn(ageBand, guardianConsent);

          const resource = {
            kind: "campaign_view" as const,
            id: `camp-${randomUUID()}`,
            attr: {
              state: "live",
              region: "ID",
              audience,
              openViewingEnabled: true,
              openViewingBudgetRemaining: 500,
            },
          };

          const watchOpen = await pdp.requireAction(principal, resource, "watch_open");
          const earn = await pdp.requireAction(principal, resource, "earn");

          expect(watchOpen.isOk()).toBe(expectedWatchOpen);
          expect(earn.isOk()).toBe(expectedEarn);
        });
      }
    }
  }
});

describe("12.1.b parity: listing's consumer-browse-is-audience-gated rule vs reachesAudience", () => {
  for (const ageBand of AGE_BANDS) {
    for (const audience of AUDIENCES) {
      it(`ageBand=${ageBand ?? "none"} audience=${audience}`, async () => {
        const principal = principalFor(ageBand, undefined);
        const expectedReach =
          ageBand === undefined ? audience === "all_ages" : reachesAudience(audience, { ageBand });

        const resource = {
          kind: "listing" as const,
          id: `list-${randomUUID()}`,
          attr: { region: "ID", audience },
        };

        const browse = await pdp.requireAction(principal, resource, "browse");
        expect(browse.isOk()).toBe(expectedReach);
      });
    }
  }
});
