import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { StudioShell } from "@yourtal/ui/studio-shell";
import { Text } from "@yourtal/ui/text";
import type { StaffSession } from "@yourtal/contracts/staff/session";
import { LogoutButton } from "@/features/me/logout-button";
import { StaffNav } from "./staff-nav";
import { zonesFor } from "./staff-zones";

export interface StaffChromeProps {
  readonly session: StaffSession;
  readonly children: ReactNode;
}

/** Every `/staff/**` page sits in this: the Studio shell with the console's own nav. */
export async function StaffChrome({ session, children }: StaffChromeProps) {
  const t = await getTranslations("staff");
  const items = zonesFor(session.roles).map((zone) => ({
    href: zone.href,
    label: t(`nav.${zone.key}`),
  }));
  return (
    <StudioShell
      nav={
        <nav
          aria-label={t("chrome.navLabel")}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:w-full lg:flex-none lg:flex-col lg:items-stretch lg:gap-3"
        >
          <div className="flex min-w-0 flex-col px-3 lg:py-2">
            <Text size="label">{t("chrome.title")}</Text>
            {session.email === null ? null : (
              <Text size="caption" tone="muted" className="break-all">
                {session.email}
              </Text>
            )}
          </div>
          <StaffNav items={items} />
          <div className="px-3 lg:mt-auto">
            <LogoutButton label={t("chrome.signOut")} />
          </div>
        </nav>
      }
    >
      {children}
    </StudioShell>
  );
}
