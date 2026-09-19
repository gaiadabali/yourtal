// Placeholder for the Store tab (docs/17-surfaces-and-roles.md §1.1:
// "Tokopedia product grid — vouchers, digital goods, merchandise."). Real
// screen is a separate ticket; YT-0402 only owns the route existing under
// the shell with the correct tab wired up.
export default function StorePage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-sans font-semibold text-fg">Store</h1>
      <p className="mt-2 text-sm font-sans text-fg-muted">
        The voucher and goods catalogue lands here in a later ticket. This page only proves the
        route and tab are wired up.
      </p>
    </div>
  );
}
