/**
 * The staff and opt-out wire shapes of spambank/BUILD.md 5.4. They live in
 * `@yourtal/contracts/spambank/staff` (T7, the API that serves them); this
 * file keeps the names the screens were built with.
 */
export { AUTOREPLY_MODES } from "@yourtal/contracts/spambank/common";
export {
  BLOCKLIST_RESULTS,
  OPTOUT_DOMAIN_PATTERN as OPTOUT_DOMAIN,
  OPTOUT_SIG_PATTERN as OPTOUT_SIG,
  blocklistCheckSchema,
  leadStatusSchema,
  optoutStatusSchema,
  spambankAutoreplySchema,
  spambankLeadPageSchema,
  spambankLeadSchema,
} from "@yourtal/contracts/spambank/staff";
export type {
  BlocklistCheck,
  OptoutStatus,
  SpambankAutoreply,
  SpambankAutoreplyChange,
  SpambankLead,
  SpambankLeadPage,
} from "@yourtal/contracts/spambank/staff";
