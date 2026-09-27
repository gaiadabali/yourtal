export interface StudioSetupStatus {
  /** Channel settings (logo, cover, handle) have been touched at least once. Mock proxy: a non-null logoUrl. */
  channelSet: boolean;
  /** The business holds points to spend (task 7.5's balance, mock for now). */
  pointsBought: boolean;
  /** At least one campaign draft has media uploaded. */
  campaignUploaded: boolean;
  /** At least one campaign draft has its question bank filled in. */
  questionsWritten: boolean;
  /** At least one campaign has been submitted for review. */
  campaignSubmitted: boolean;
}

export interface StudioSetupStep {
  id: keyof StudioSetupStatus;
  label: string;
  href: string;
  done: boolean;
}

const STEP_ORDER: readonly { id: keyof StudioSetupStatus; label: string; href: string }[] = [
  { id: "channelSet", label: "Set up your channel", href: "/studio/channel" },
  { id: "pointsBought", label: "Buy points", href: "/studio/billing" },
  { id: "campaignUploaded", label: "Upload a campaign video", href: "/studio/campaigns" },
  { id: "questionsWritten", label: "Write your question bank", href: "/studio/campaigns" },
  { id: "campaignSubmitted", label: "Submit for review", href: "/studio/campaigns" },
];

/** Builds the ordered checklist (task 7.8.b's empty state), from whichever steps are already done. */
export function buildSetupChecklist(status: StudioSetupStatus): StudioSetupStep[] {
  return STEP_ORDER.map((step) => ({ ...step, done: status[step.id] }));
}

/** The checklist is "complete" — and the overview should show the real dashboard instead — once every step is done. */
export function isSetupComplete(status: StudioSetupStatus): boolean {
  return Object.values(status).every(Boolean);
}
