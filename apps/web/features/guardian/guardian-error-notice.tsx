"use client";

import { useRouter } from "next/navigation";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { getGuardianTranslator } from "./guardian-i18n";

/**
 * The transient-failure state (12.2.c): `GET /api/guardian/:token` itself
 * failed (network error, 5xx, or a body that didn't match the contract) —
 * distinct from `not-found.tsx`'s "this token doesn't exist" 404, which is
 * not transient and has no retry. No locale is known here either (the
 * response that would have carried it is exactly what failed), so this
 * speaks the default locale (en-AU) only, same as the invalid-token notice.
 */
export function GuardianErrorNotice() {
  const t = getGuardianTranslator("en-AU");
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      <Text tone="muted">{t("error.body")}</Text>
      <Button type="button" variant="secondary" onClick={() => router.refresh()}>
        {t("error.retryCta")}
      </Button>
    </div>
  );
}
