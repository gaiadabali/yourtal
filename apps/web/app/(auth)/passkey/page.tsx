import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/features/auth/auth-card";
import { PasskeyPrompt } from "@/features/auth/passkey-prompt";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";
import { readSessionToken } from "@/lib/api/session-cookies";

export interface PasskeyPromptPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/passkey`: the one-time offer to add a passkey, shown right after a
 * password sign-in. It adds a credential to the signed-in account, so it needs
 * the session that sign-in just set; without one it goes to `/login`.
 */
export default async function PasskeyPromptPage({ searchParams }: PasskeyPromptPageProps) {
  const params = await searchParams;
  const parsed = parseReturnTo(params["returnTo"]);
  const returnTo = parsed ?? "/";
  // Only the earning prompt sends `reason=earn`, and only with a return path to go back to.
  const earn = params["reason"] === "earn" && parsed !== null;

  if ((await readSessionToken()) === null) redirect("/login");

  const t = await getTranslations("auth.passkeyPrompt");
  return (
    <AuthCard
      title={t(earn ? "earnHeading" : "heading")}
      description={t(earn ? "earnBody" : "body")}
    >
      <PasskeyPrompt returnTo={returnTo} reason={earn ? "earn" : undefined} />
    </AuthCard>
  );
}
