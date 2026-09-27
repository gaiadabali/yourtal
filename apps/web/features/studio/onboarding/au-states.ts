import { AU_STATES as AU_STATE_CODES } from "@yourtal/contracts/business";

const AU_STATE_NAMES: Record<(typeof AU_STATE_CODES)[number], string> = {
  NSW: "New South Wales",
  VIC: "Victoria",
  QLD: "Queensland",
  WA: "Western Australia",
  SA: "South Australia",
  TAS: "Tasmania",
  ACT: "Australian Capital Territory",
  NT: "Northern Territory",
};

/** State/territory options for the onboarding address form — the codes come from the contract, not a second hand-kept list. */
export const AU_STATES: readonly { value: string; label: string }[] = AU_STATE_CODES.map(
  (code) => ({ value: code, label: AU_STATE_NAMES[code] }),
);
