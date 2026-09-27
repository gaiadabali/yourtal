import { Badge } from "@yourtal/ui/badge";
import { getStudioTranslator, type SupportedLocale } from "./studio-i18n";
import type { BusinessMembership } from "./studio-data";
import { StudioBusinessSwitcher } from "./studio-business-switcher";
import { ROLE_LABELS } from "./studio-roles";

export interface StudioIdentityPanelProps {
  current: BusinessMembership;
  /** Every business the signed-in person holds a role at, for the switcher — omitted entirely (not just hidden) when there is only one. */
  allMemberships: readonly BusinessMembership[];
  defaultBusinessId: string;
  locale: SupportedLocale;
}

/**
 * Business identity (name, verified badge, role) plus the business switcher
 * — rendered as the first item inside `StudioShell`'s `nav` slot
 * (`studio-chrome.tsx`), above the zone links, so it appears once at the
 * head of the sidebar rather than in a separate header row. Server
 * Component; the only client leaf underneath is `StudioBusinessSwitcher`.
 */
export function StudioIdentityPanel({
  current,
  allMemberships,
  defaultBusinessId,
  locale,
}: StudioIdentityPanelProps) {
  const t = getStudioTranslator(locale);
  return (
    <div className="flex w-full min-w-0 shrink-0 flex-col gap-2 border-b border-border-subtle pb-3 lg:mb-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-title font-sans font-semibold text-fg">
            {current.business.displayName}
          </p>
          {current.business.isVerified ? (
            <Badge variant="success">{t("chrome.identity.verified")}</Badge>
          ) : null}
        </div>
        <p className="text-label text-fg-muted">
          {current.myRole ? ROLE_LABELS[current.myRole] : t("chrome.identity.unassignedMember")}
        </p>
      </div>
      {allMemberships.length > 1 ? (
        <StudioBusinessSwitcher
          currentBusinessId={current.business.id}
          defaultBusinessId={defaultBusinessId}
          options={allMemberships.map((membership) => ({
            id: membership.business.id,
            displayName: membership.business.displayName,
            myRole: membership.myRole
              ? ROLE_LABELS[membership.myRole]
              : t("chrome.identity.noRole"),
          }))}
        />
      ) : null}
    </div>
  );
}
