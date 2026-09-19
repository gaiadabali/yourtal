// Placeholder for the Quick tab (docs/17-surfaces-and-roles.md §1.1:
// "TikTok — vertical, swipeable. 15-60s campaigns, points only. This is the
// habit loop."). Real screen is a separate ticket; YT-0402 only owns the
// route existing under the shell with the correct tab wired up.
export default function QuickPage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-sans font-semibold text-fg">Quick</h1>
      <p className="mt-2 text-sm font-sans text-fg-muted">
        Short, swipeable campaigns land here in a later ticket. This page only proves the route
        and tab are wired up.
      </p>
    </div>
  );
}
