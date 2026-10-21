/**
 * Where the API said to send the browser next: the provider on YourTal's own
 * address, which then returns to the app. Only http(s) is ever navigated to,
 * so a malformed answer cannot become a `javascript:` or `data:` URL.
 */
export function isNavigableRedirect(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
