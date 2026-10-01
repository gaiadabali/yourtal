/**
 * 13.3.e: the only hops whose X-Forwarded-For the api believes: this host's own
 * processes. nginx sets it to the client's address, and the web server passes on
 * its viewer's; both reach the api over loopback, and nothing else can.
 */
export const TRUSTED_PROXIES: readonly string[] = ["127.0.0.1", "::1"];
