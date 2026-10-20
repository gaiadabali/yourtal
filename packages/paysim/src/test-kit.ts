/* eslint-disable @typescript-eslint/no-explicit-any -- tests read dynamic JSON bodies */
import { createBrowser, type PaySimBrowser } from "./browser";
import { type PaySimServer, startPaySimServer } from "./server";

/** Shared by the suites: a clock, a recording webhook receiver and a form-encoding client. */
export interface Params {
  [key: string]: Params | Array<Params | string | number> | string | number | boolean | undefined;
}

export function encode(params: Params, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const name = prefix === "" ? key : `${prefix}[${key}]`;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object") out.push(...encode(item, `${name}[${i}]`));
        else out.push(`${encodeURIComponent(`${name}[]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === "object") {
      out.push(...encode(value, name));
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

export interface Call {
  method: string;
  path: string;
  status: number;
  headers: Headers;
  json: Record<string, any>;
  text: string;
}

export interface Hook {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface Kit {
  sim: PaySimServer;
  browser: PaySimBrowser;
  hooks: Hook[];
  /** Status the fake webhook receiver answers with; a function can vary it per call. */
  respondWith: { status: number | ((h: Hook) => number) };
  advance(ms: number): void;
  now(): Date;
  call(
    method: "GET" | "POST",
    path: string,
    params?: Params,
    headers?: Record<string, string>,
  ): Promise<Call>;
  get(path: string, params?: Params, headers?: Record<string, string>): Promise<Call>;
  post(path: string, params?: Params, headers?: Record<string, string>): Promise<Call>;
}

export async function makeKit(opts: { start?: string } = {}): Promise<Kit> {
  let time = new Date(opts.start ?? "2026-10-20T00:00:00Z");
  const hooks: Hook[] = [];
  const respondWith: Kit["respondWith"] = { status: 200 };
  const fakeFetch: typeof fetch = (_url, init) => {
    const hook: Hook = {
      url: typeof _url === "string" ? _url : _url instanceof URL ? _url.href : _url.url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === "string" ? init.body : "",
    };
    hooks.push(hook);
    const status =
      typeof respondWith.status === "function" ? respondWith.status(hook) : respondWith.status;
    return Promise.resolve(new Response("ok", { status }));
  };
  const sim = await startPaySimServer({
    now: () => new Date(time),
    fetch: fakeFetch,
    webhookUrl: "http://receiver.test/hook",
  });
  const call: Kit["call"] = async (method, path, params = {}, headers = {}) => {
    const qs = encode(params).join("&");
    const url =
      method === "GET" && qs !== "" ? `${sim.baseUrl}${path}?${qs}` : `${sim.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${sim.secretKey}`,
        ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...headers,
      },
      ...(method === "POST" ? { body: qs } : {}),
    });
    const text = await res.text();
    return {
      method,
      path,
      status: res.status,
      headers: res.headers,
      json: text.startsWith("{") ? (JSON.parse(text) as Record<string, any>) : {},
      text,
    };
  };
  return {
    sim,
    browser: createBrowser(sim.config.publicBaseUrl),
    hooks,
    respondWith,
    advance: (ms) => {
      time = new Date(time.getTime() + ms);
    },
    now: () => new Date(time),
    call,
    get: (path, params, headers) => call("GET", path, params, headers),
    post: (path, params, headers) => call("POST", path, params, headers),
  };
}

export const CARD_OK = { number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123" };
export const CARD_DECLINED = { number: "4000 0000 0000 0002", expiry: "12 / 34", cvc: "123" };
export const CARD_3DS = { number: "4000 0025 0000 3155", expiry: "12 / 34", cvc: "123" };

export function paymentSession(extra: Params = {}): Params {
  return {
    mode: "payment",
    success_url: "https://app.test/ok?s={CHECKOUT_SESSION_ID}",
    cancel_url: "https://app.test/cancel",
    line_items: [
      {
        quantity: 1,
        price_data: { currency: "aud", unit_amount: 4500, product_data: { name: "Voucher" } },
      },
    ],
    ...extra,
  };
}

/** An onboarded Express account with a bank account that pays out. */
export async function onboardedAccount(
  k: Kit,
  account = "000123456",
  extra: Params = {},
): Promise<string> {
  const created = await k.post("/v1/accounts", {
    type: "express",
    country: "AU",
    capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
    ...extra,
  });
  const id = created.json["id"] as string;
  const link = await k.post("/v1/account_links", {
    account: id,
    type: "account_onboarding",
    refresh_url: "https://app.test/refresh",
    return_url: "https://app.test/return",
  });
  const token = (link.json["url"] as string).split("/").pop() ?? "";
  await k.browser.completeOnboarding(token, { bsb: "110000", account });
  return id;
}

/** Pays a Checkout session with a good card and returns the PaymentIntent id. */
export async function paidIntent(k: Kit, amount = 4500): Promise<string> {
  const s = await k.post(
    "/v1/checkout/sessions",
    paymentSession({
      line_items: [
        {
          quantity: 1,
          price_data: { currency: "aud", unit_amount: amount, product_data: { name: "Voucher" } },
        },
      ],
    }),
  );
  await k.browser.submitCheckout(s.json["id"] as string, CARD_OK);
  const got = await k.get(`/v1/checkout/sessions/${s.json["id"] as string}`);
  return got.json["payment_intent"] as string;
}
