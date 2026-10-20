import * as client from "openid-client";

/**
 * Test-only: drives a sign-in the way it happens for real. A browser with a
 * cookie jar follows the provider's redirects; YourTal's web server is played
 * by plain calls to the interaction API carrying the browser's cookies for the
 * `/connect/<uid>` page plus the YourTal session, exactly what the page's
 * server will forward. openid-client is the app.
 */
interface StoredCookie {
  readonly value: string;
  readonly path: string;
}

export class Browser {
  private readonly cookies = new Map<string, StoredCookie>();

  /** GET without following redirects, keeping every cookie the response sets. */
  async get(url: URL | string): Promise<Response> {
    const target = new URL(url);
    const response = await fetch(target, {
      redirect: "manual",
      headers: { cookie: this.cookieHeader(target.pathname) },
    });
    for (const line of response.headers.getSetCookie()) this.keep(line);
    return response;
  }

  /** The cookies a browser sends to this path, whatever the host (the test plays both origins). */
  cookieHeader(pathname: string): string {
    return [...this.cookies.entries()]
      .filter(([, cookie]) => pathname.startsWith(cookie.path))
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join("; ");
  }

  private keep(line: string): void {
    const [pair = "", ...attributes] = line.split(";");
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const pathAttribute = attributes
      .map((attribute) => attribute.trim())
      .find((attribute) => attribute.toLowerCase().startsWith("path="));
    const path = pathAttribute?.slice(5) ?? "/";
    const expired = attributes.some((attribute) => /expires=Thu, 01 Jan 1970/i.test(attribute));
    if (expired || value.length === 0) this.cookies.delete(name);
    else this.cookies.set(name, { value, path });
  }
}

export interface StartedSignIn {
  readonly browser: Browser;
  readonly uid: string;
  readonly verifier: string;
  readonly state: string;
  readonly nonce: string;
}

/** The app starts a sign-in; the browser lands on YourTal's /connect/<uid> page. */
export async function startSignIn(
  config: client.Configuration,
  redirectUri: string,
  extra: Record<string, string> = {},
): Promise<StartedSignIn> {
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid email profile account",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
    ...extra,
  });
  const browser = new Browser();
  const response = await browser.get(url);
  const location = response.headers.get("location") ?? "";
  const match = /\/connect\/([^/?#]+)$/.exec(new URL(location).pathname);
  if (response.status !== 303 || match?.[1] === undefined) {
    throw new Error(`expected the /connect page, got ${String(response.status)} ${location}`);
  }
  return { browser, uid: decodeURIComponent(match[1]), verifier, state, nonce };
}

/** What YourTal's web server does for the page: call the API with the browser's cookies. */
export function webServerCall(
  apiBase: string,
  started: StartedSignIn,
  sessionToken: string | null,
  step: "" | "/continue" | "/cancel",
  body?: unknown,
): Promise<Response> {
  const pageCookies = started.browser.cookieHeader(`/connect/${started.uid}`);
  const cookie = [pageCookies, sessionToken === null ? "" : `yt_session=${sessionToken}`]
    .filter((part) => part.length > 0)
    .join("; ");
  return fetch(`${apiBase}/api/connect/${encodeURIComponent(started.uid)}${step}`, {
    method: step === "" ? "GET" : "POST",
    headers: { cookie, ...(step === "" ? {} : { "content-type": "application/json" }) },
    ...(step === "" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}

/** The browser follows `redirectTo` through the provider back to the app's redirect URI. */
export async function followToApp(started: StartedSignIn, redirectTo: string): Promise<URL> {
  const response = await started.browser.get(redirectTo);
  const location = response.headers.get("location");
  if (response.status < 300 || response.status > 303 || location === null) {
    throw new Error(`expected a redirect to the app, got ${String(response.status)}`);
  }
  return new URL(location);
}
