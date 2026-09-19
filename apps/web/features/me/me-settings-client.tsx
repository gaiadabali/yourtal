"use client";

import { useState } from "react";
import { MeConsentSection } from "./me-consent-section";
import { MeInterestsSection } from "./me-interests-section";
import { readConsentPreferences, writeConsentPreferences } from "./me-consent-store";
import { withPurposeChanged, type ConsentPurposeId } from "./me-consent";
import { readInterestIds, writeInterestIds } from "./me-interests-store";
import type { SupportedLocale } from "./me-i18n";

export interface MeSettingsClientProps {
  locale: SupportedLocale;
}

/**
 * Owns the one piece of state the consent and interests sections must
 * genuinely share: the personalisation toggle's preview shows the user's
 * declared interests, so both live in one parent rather than two
 * components each reading their own copy of the truth (docs/13b-typescript-standards.md
 * §8: composition over prop-drilling — this is exactly the "two levels"
 * case that rule allows, page.tsx -> MeSettingsClient -> the two sections).
 *
 * Both stores are read once, lazily, on this component's own first client
 * render (`useState(() => ...)`) — the same "read localStorage directly,
 * no separate loading flash" approach `voucher-detail-view.tsx` already
 * uses in this codebase, rather than a `useEffect` + loading state, since a
 * Server Component parent has no access to `localStorage` to seed an
 * initial prop with.
 */
export function MeSettingsClient({ locale }: MeSettingsClientProps) {
  const [preferences, setPreferences] = useState(() =>
    readConsentPreferences(new Date().toISOString()),
  );
  const [interestIds, setInterestIds] = useState<readonly string[]>(() => readInterestIds());

  function handlePurposeChange(purpose: ConsentPurposeId, granted: boolean) {
    const next = withPurposeChanged(preferences, purpose, granted, new Date().toISOString());
    setPreferences(next);
    writeConsentPreferences(next);
  }

  function handleInterestToggle(id: string) {
    const next = interestIds.includes(id)
      ? interestIds.filter((existing) => existing !== id)
      : [...interestIds, id];
    setInterestIds(next);
    writeInterestIds(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <MeConsentSection
        locale={locale}
        preferences={preferences}
        interestIds={interestIds}
        onPurposeChange={handlePurposeChange}
      />
      <MeInterestsSection
        locale={locale}
        selectedIds={interestIds}
        onToggle={handleInterestToggle}
      />
    </div>
  );
}
