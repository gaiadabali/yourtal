import type { ReactNode } from "react";
import Link from "next/link";
import { BrandWordmark } from "@yourtal/ui/brand/wordmark";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@yourtal/ui/card";

export interface AuthCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The shared centred-card shell every (auth) screen renders inside (6.2.a):
 * one brand mark, one heading, one place for a "sign in instead" link.
 * Server-rendered — nothing here needs client state.
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-gutter-sm py-12">
      <Link href="/" aria-label="YourTal">
        <BrandWordmark size="md" />
      </Link>
      <Card variant="plain" className="w-full max-w-md">
        <CardHeader>
          <CardTitle as="h1">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">{children}</CardContent>
      </Card>
      {footer ? <div className="text-center text-body-sm font-sans text-fg-muted">{footer}</div> : null}
    </div>
  );
}
