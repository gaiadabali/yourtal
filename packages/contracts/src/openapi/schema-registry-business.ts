import { businessRoleSchema, businessSchema } from "../business/business";
import { businessTeamRoleSchema } from "../business/business-team-role";
import { businessMemberSchema } from "../business/business-member";
import { billingContactSchema } from "../business/billing-contact";
import {
  kybDocumentSchema,
  kybDocumentStatusSchema,
  kybDocumentTypeSchema,
} from "../business/kyb-document";
import { questionOptionSchema, questionSchema } from "../question/question";
import type { ContractComponent } from "./schema-registry";

/**
 * The business- and question-domain half of `CONTRACT_COMPONENTS`, split
 * out of `schema-registry.ts` purely to stay under the 300-line ceiling —
 * see that file for what this list means and how it is checked.
 */
export const BUSINESS_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  // --- business ---
  {
    id: "BusinessRole",
    schema: businessRoleSchema,
    description:
      "A relationship a business holds with the platform, of which it may hold any subset (docs/17 section 2). NOT the per-person team role — that is BusinessTeamRole.",
    crossFieldRules: [],
  },
  {
    id: "BusinessTeamRole",
    schema: businessTeamRoleSchema,
    description:
      "The job one person does inside one business (docs/17 section 2.1). Defined here rather than in @yourtal/authz because a member carries it in an API payload; authz imports it and keeps the drift test against the Cerbos principal schema (YT-0509). Store staff are absent by design — they are device sessions, not members.",
    crossFieldRules: [],
  },
  {
    id: "Business",
    schema: businessSchema,
    description: "An advertiser, supplier and/or redeemer.",
    crossFieldRules: ["roles must not contain duplicates."],
  },
  {
    id: "BusinessMember",
    schema: businessMemberSchema,
    description:
      "A person's membership at one business (docs/17 section 2.1's six roles). NOT the Business-level `BusinessRole` above — this is the per-person team role, sourced from @yourtal/authz/roles so it cannot drift from the authorization model.",
    crossFieldRules: [],
  },
  {
    id: "BillingContact",
    schema: billingContactSchema,
    description:
      "The person a business's invoices and settlement statements are sent to (docs/17 section 2, Billing zone).",
    crossFieldRules: [],
  },
  {
    id: "KybDocumentType",
    schema: kybDocumentTypeSchema,
    description:
      "A category of Know-Your-Business document a business can submit during onboarding.",
    crossFieldRules: [],
  },
  {
    id: "KybDocumentStatus",
    schema: kybDocumentStatusSchema,
    description: "Review state of a submitted KYB document.",
    crossFieldRules: [],
  },
  {
    id: "KybDocument",
    schema: kybDocumentSchema,
    description:
      "A business's submitted KYB document and its review state (docs/17 section 5). `storageRef` is an opaque pointer to encrypted bytes; this schema does not cover the upload path itself.",
    crossFieldRules: [],
  },

  // --- questions ---
  {
    id: "QuestionOption",
    schema: questionOptionSchema,
    description: "One selectable answer.",
    crossFieldRules: [],
  },
  {
    id: "Question",
    schema: questionSchema,
    description:
      "A checkpoint question, discriminated on type. Variants are inlined rather than named as components because they are never referenced independently.",
    crossFieldRules: [
      "multiple_choice: correctOptionId must reference one of the provided options.",
      "likert: scaleMin must be less than scaleMax.",
    ],
  },
];
