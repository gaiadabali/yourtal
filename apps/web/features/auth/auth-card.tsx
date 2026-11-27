import type { ReactNode } from "react";
import { BrandWordmark } from "@yourtal/ui/brand/wordmark";
import { Card, CardContent, CardHeader } from "@yourtal/ui/card";
import { Heading } from "@yourtal/ui/heading";
import { Mascot } from "@yourtal/ui/brand/mascot";
import { Text } from "@yourtal/ui/text";

export interface AuthCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The shared centred-card shell every (auth) screen renders inside (6.2.a):
 * the logo, the mascot, one heading, one place for a "sign in instead" link.
 * Server-rendered — nothing here needs client state.
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-gutter-sm py-12">
      {/* Not a link: "/" resolves through `route-redirects.ts` depending on
          sign-in state, and every (auth) screen is reached in exactly the
          state that redirect is for — nothing here to navigate to instead. */}
      <div className="flex flex-col items-center gap-5">
        <BrandWordmark size="md" />
        {/* Beside the heading below, which says what this screen is for: decorative. */}
        <Mascot size="md" />
      </div>
      <Card variant="plain" className="w-full max-w-md">
        <CardHeader>
          {/* A real <h1>: this card IS the page's content, so its title is
              the page's own heading, not CardTitle's default h3. */}
          <Heading level={1} size="headline">
            {title}
          </Heading>
          {description ? <Text tone="muted">{description}</Text> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">{children}</CardContent>
      </Card>
      {footer ? (
        <div className="text-center text-body-sm font-sans text-fg-muted">{footer}</div>
      ) : null}
    </main>
  );
}
