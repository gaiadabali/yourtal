"use client";

import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { demoSignInAction } from "@/lib/api/actions";
import { clearSessionScopedServiceWorkerCache } from "@/features/shell/clear-session-cache";

export interface DemoSignInListProps {
  people: readonly { email: string; displayName: string; region: "AU" | "ID" }[];
  returnTo?: string | undefined;
}

/** One form per demo person; like the password form, forgets the previous account's cached pages first. */
export function DemoSignInList({ people, returnTo }: DemoSignInListProps) {
  const t = useTranslations("auth.login");
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {people.map((person) => (
        <li key={person.email}>
          <form action={demoSignInAction} onSubmit={() => clearSessionScopedServiceWorkerCache()}>
            {/* eslint-disable-next-line yt-b/prefer-primitives */}
            <input type="hidden" name="email" value={person.email} />
            {returnTo ? (
              // eslint-disable-next-line yt-b/prefer-primitives
              <input type="hidden" name="returnTo" value={returnTo} />
            ) : null}
            <Button type="submit" variant="secondary" size="sm" className="w-full justify-between">
              <span>{t("demoContinueAs", { name: person.displayName })}</span>
              <span className="text-caption text-fg-muted">{person.email}</span>
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}
