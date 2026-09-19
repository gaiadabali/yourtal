// Placeholder for the Wallet tab (docs/17-surfaces-and-roles.md §1.1:
// "Banking app, simplified — balance, pending, expiring soon, vouchers with
// their QR, history."). Real screen is a separate ticket; YT-0402 only owns
// the route existing under the shell with the correct tab wired up.
export default function WalletPage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-sans font-semibold text-fg">Wallet</h1>
      <p className="mt-2 text-sm font-sans text-fg-muted">
        Balance, pending holdback and vouchers land here in a later ticket. This page only proves
        the route and tab are wired up.
      </p>
    </div>
  );
}
