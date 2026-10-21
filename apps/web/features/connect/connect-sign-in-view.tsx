"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import { Button } from "@yourtal/ui/button";
import { AuthCard } from "@/features/auth/auth-card";
import { connectPath } from "./connect-uid";

export interface ConnectSignInViewProps {
  details: InteractionDetails;
}

/**
 * `login` and `create`: the person has no YourTal session. Signing in and
 * creating an account are the existing `/login` and `/register` pages, sent
 * back here afterwards, so every sign-in step they gain applies to apps too.
 */
export function ConnectSignInView({ details }: ConnectSignInViewProps) {
  const create = details.screen === "create";
  const t = useTranslations(create ? "connect.create" : "connect.login");
  const returnTo = connectPath(details.uid);
  const app = details.client.name;

  const primary = create
    ? { pathname: "/register" as const, label: t("createCta") }
    : { pathname: "/login" as const, label: t("signInCta") };
  const secondary = create
    ? { pathname: "/login" as const, prompt: t("havePrompt"), label: t("signInCta") }
    : { pathname: "/register" as const, prompt: t("newPrompt"), label: t("createCta") };

  return (
    <AuthCard
      title={t("heading", { app })}
      description={t("intro", { app })}
      footer={
        <>
          {secondary.prompt}{" "}
          <Link
            href={{ pathname: secondary.pathname, query: { returnTo } }}
            className="text-accent underline underline-offset-4"
          >
            {secondary.label}
          </Link>
        </>
      }
    >
      <Button asChild>
        <Link href={{ pathname: primary.pathname, query: { returnTo } }}>{primary.label}</Link>
      </Button>
    </AuthCard>
  );
}
