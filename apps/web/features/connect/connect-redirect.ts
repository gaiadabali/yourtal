/**
 * Where the API said to send the browser next: the provider on YourTal's own
 * address, which then returns to the app. Only http(s) is ever navigated to,
 * so a malformed answer cannot become a `javascript:` or `data:` URL, and
 * only the provider's own routes, so it cannot become a page elsewhere.
 */
export function isNavigableRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && url.pathname.startsWith("/oidc/")
    );
  } catch {
    return false;
  }
}
