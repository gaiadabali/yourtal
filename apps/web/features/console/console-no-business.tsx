import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";

/**
 * Shown when the signed-in person holds no role at any business — an
 * ordinary consumer who has navigated to `/business` directly. Honest
 * empty state rather than a dead end: explains what the console is for
 * and that reaching it requires being invited or registering a business,
 * neither of which this ticket builds (registration is a future ticket;
 * onboarding is owned by a parallel session).
 */
export function ConsoleNoBusiness() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold text-fg">Business console</h1>
      <Card>
        <CardHeader>
          <CardTitle>No business console yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-sans text-fg-muted">
            You don&rsquo;t hold a role at any business yet. Ask a business Owner or Admin to invite
            you, or register your own business to get a console like this one.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
