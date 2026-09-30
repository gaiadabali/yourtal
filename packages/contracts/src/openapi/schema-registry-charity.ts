import {
  auCharityRegistrationSchema,
  charityApplicationRequestSchema,
  charityCauseSchema,
  charityDecisionRequestSchema,
  charityDetailListSchema,
  charityDetailSchema,
  charityPayoutAccountInputSchema,
  charityRegistrationSchema,
  charityStateSchema,
  idCharityRegistrationSchema,
  publicCharityListSchema,
  publicCharitySchema,
  charityProceedSchema,
  charityStatementSchema,
  charityConsoleSchema,
} from "../charity/charity";
import type { ContractComponent } from "./schema-registry";

/** 13.21: the charity registry, split out for the 300-line ceiling. */
export const CHARITY_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "CharityState",
    schema: charityStateSchema,
    description: "A charity's review state.",
    crossFieldRules: [],
  },
  {
    id: "CharityCause",
    schema: charityCauseSchema,
    description: "What a charity works on.",
    crossFieldRules: [],
  },
  {
    id: "AuCharityRegistration",
    schema: auCharityRegistrationSchema,
    description: "An AU charity: an ABN registered with the ACNC.",
    crossFieldRules: [],
  },
  {
    id: "IdCharityRegistration",
    schema: idCharityRegistrationSchema,
    description: "An ID charity: a yayasan's deed and its public fundraising permit.",
    crossFieldRules: [],
  },
  {
    id: "CharityRegistration",
    schema: charityRegistrationSchema,
    description: "A charity's registration, by region.",
    crossFieldRules: [],
  },
  {
    id: "CharityPayoutAccountInput",
    schema: charityPayoutAccountInputSchema,
    description:
      "The charity's own bank account, sent once for the KYB check; stored only as a provider reference and the last four digits.",
    crossFieldRules: [],
  },
  {
    id: "CharityApplicationRequest",
    schema: charityApplicationRequestSchema,
    description: "POST /api/charities/applications's body.",
    crossFieldRules: ["an AU charity registers with the ACNC; an ID charity is a yayasan."],
  },
  {
    id: "PublicCharity",
    schema: publicCharitySchema,
    description: "An approved charity as a viewer in its region sees it.",
    crossFieldRules: [],
  },
  {
    id: "CharityDetail",
    schema: charityDetailSchema,
    description:
      "A charity as its applicant and staff see it, with review state and the masked payout account.",
    crossFieldRules: [],
  },
  {
    id: "CharityDecisionRequest",
    schema: charityDecisionRequestSchema,
    description: "A staff approve or reject, always with a reason.",
    crossFieldRules: [],
  },
  {
    id: "PublicCharityList",
    schema: publicCharityListSchema,
    description: "GET /api/charities.",
    crossFieldRules: [],
  },
  {
    id: "CharityDetailList",
    schema: charityDetailListSchema,
    description: "GET /api/staff/charities and GET /api/me/charities.",
    crossFieldRules: [],
  },
  {
    id: "CharityProceed",
    schema: charityProceedSchema,
    description: "One auction's proceeds, paid straight to the charity's own account.",
    crossFieldRules: [],
  },
  {
    id: "CharityStatement",
    schema: charityStatementSchema,
    description: "A month's proceeds per currency.",
    crossFieldRules: [],
  },
  {
    id: "CharityConsole",
    schema: charityConsoleSchema,
    description:
      "GET /api/charities/{charityId}/console: the charity, its proceeds and statements.",
    crossFieldRules: [],
  },
];
