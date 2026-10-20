/**
 * "Acts as the browser" for tests: loads a page, reads its CSRF token like a
 * form would send it back, posts the form, and does not follow the redirect.
 */
export interface BrowserResult {
  status: number;
  /** The `Location` of a redirect, as sent. */
  location: string | null;
  html: string;
}

export interface Card {
  number: string;
  expiry: string;
  cvc: string;
}

export interface PaySimBrowser {
  get(path: string): Promise<BrowserResult>;
  /** The CSRF token a page would send back; a stale tab keeps its old one. */
  csrfFrom(path: string): Promise<string>;
  submitCheckout(sessionId: string, card: Card, csrf?: string): Promise<BrowserResult>;
  decideThreeDS(sessionId: string, outcome: "complete" | "fail"): Promise<BrowserResult>;
  completeOnboarding(
    token: string,
    form: { name?: string; bsb: string; account: string },
  ): Promise<BrowserResult>;
}

export function createBrowser(pageBase: string, fetchImpl: typeof fetch = fetch): PaySimBrowser {
  const base = pageBase.replace(/\/+$/, "");

  async function load(url: string, init?: RequestInit): Promise<BrowserResult> {
    const res = await fetchImpl(url, { redirect: "manual", ...init });
    return { status: res.status, location: res.headers.get("location"), html: await res.text() };
  }

  const get = (path: string): Promise<BrowserResult> => load(`${base}${path}`);

  /** The CSRF token from a page, following one redirect inside the pages. */
  async function csrfFrom(path: string): Promise<string> {
    let page = await get(path);
    if (page.status === 303 && page.location !== null) {
      page = await load(new URL(page.location, `${base}/`).toString());
    }
    const m = /name="csrf" value="([^"]+)"/.exec(page.html);
    return m?.[1] ?? "";
  }

  const post = (path: string, fields: Record<string, string>): Promise<BrowserResult> =>
    load(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });

  return {
    get,
    csrfFrom,
    async submitCheckout(sessionId, card, csrf) {
      const token = csrf ?? (await csrfFrom(`/checkout/${sessionId}`));
      return post(`/checkout/${sessionId}`, { csrf: token, ...card });
    },
    async decideThreeDS(sessionId, outcome) {
      const csrf = await csrfFrom(`/checkout/${sessionId}/3ds`);
      return post(`/checkout/${sessionId}/3ds`, { csrf, outcome });
    },
    async completeOnboarding(token, form) {
      const csrf = await csrfFrom(`/connect/onboarding/${token}`);
      return post(`/connect/onboarding/${token}`, {
        csrf,
        legal_name: form.name ?? "Test Legal Name",
        bsb: form.bsb,
        account: form.account,
      });
    },
  };
}
