// Placeholder for the Me tab (docs/17-surfaces-and-roles.md §1.1:
// "Settings — profile, interests, consent controls, security, language,
// referrals."). Real screen is a separate ticket; YT-0402 only owns the
// route existing under the shell with the correct tab wired up.
export default function MePage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-sans font-semibold text-fg">Me</h1>
      <p className="mt-2 text-sm font-sans text-fg-muted">
        Profile, consent and security settings land here in a later ticket. This page only proves
        the route and tab are wired up.
      </p>
    </div>
  );
}
