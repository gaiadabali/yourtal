import { redirect } from "next/navigation";
import type { Route } from "next";
import { parseReturnTo, withReturnTo } from "@/features/onboarding/onboarding-return-to";

export interface SignupRedirectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** `/signup` is the address people guess; the real page is `/register`. Keeps `returnTo` on the way. */
export default async function SignupRedirectPage({ searchParams }: SignupRedirectPageProps) {
  const returnTo = parseReturnTo((await searchParams)["returnTo"]);
  redirect(withReturnTo("/register", returnTo) as Route);
}
