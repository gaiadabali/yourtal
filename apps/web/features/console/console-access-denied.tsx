import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";

export interface ConsoleAccessDeniedProps {
  zoneLabel: string;
}

/**
 * Shown when the signed-in person's role does not permit viewing a zone —
 * e.g. a Marketer opening `/business/team` directly by URL. This is a UI
 * courtesy, not the security boundary (docs/17, docs/14: the server/Cerbos
 * enforces this regardless of what this component does or does not
 * render) — but rendering the zone's real content here anyway would be
 * worse than no UI at all, exactly the failure mode this ticket calls out.
 */
export function ConsoleAccessDenied({ zoneLabel }: ConsoleAccessDeniedProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">You don&rsquo;t have access to {zoneLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-sans text-fg-muted">
          Your role at this business doesn&rsquo;t include {zoneLabel}. If you need it, ask an Owner
          or Admin on your team to change your role.
        </p>
      </CardContent>
    </Card>
  );
}
