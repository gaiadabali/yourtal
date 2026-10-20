import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { PaySimConfig } from "../config";
import type { Locale } from "./strings";

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
body{margin:0;background:#f6f9fc;color:#1a1f36;font:16px/1.5 system-ui,sans-serif}
main{max-width:420px;margin:0 auto;padding:24px 16px}
.banner{background:#fff4d6;border:1px solid #e5c76b;border-radius:6px;padding:8px 12px;font-size:14px;margin-bottom:16px}
.card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#4f566b;margin:0 0 16px}
label{display:block;font-size:14px;margin:12px 0 4px}
input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #c0c8d4;border-radius:6px;font:inherit}
.err{color:#b3261e;font-size:14px;margin:4px 0 0}
.top-err{color:#b3261e;margin:0 0 12px}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:6px;background:#635bff;color:#fff;font:inherit;cursor:pointer}
button.secondary{background:#e3e8ee;color:#1a1f36}
a{color:#635bff}
`;

export interface PageOptions {
  locale: Locale;
  title: string;
  banner: string;
  /** Already-escaped markup. */
  body: string;
}

export function htmlPage(o: PageOptions): string {
  return `<!doctype html>
<html lang="${o.locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title><style>${STYLE}</style></head>
<body><main><div class="banner" role="note">${esc(o.banner)}</div>
<div class="card">${o.body}</div></main></body></html>`;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * No scripts at all. `form-action` names the origins the post-submit redirect
 * may reach, because Chrome applies it to the redirect as well.
 */
export function securityHeaders(redirectUrls: readonly string[]): Record<string, string> {
  const origins = new Set<string>();
  for (const u of redirectUrls) {
    const o = originOf(u);
    if (o !== null && o !== "null") origins.add(o);
  }
  const formAction = ["'self'", ...origins].join(" ");
  return {
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}

/** A page decided inside a transaction and sent only after it commits. */
export type Page =
  | { kind: "html"; status: number; html: string; urls: readonly string[] }
  | { kind: "redirect"; url: string };

export const htmlResult = (status: number, html: string, urls: readonly string[] = []): Page => ({
  kind: "html",
  status,
  html,
  urls,
});

export const redirectResult = (url: string): Page => ({ kind: "redirect", url });

export function sendPage(reply: FastifyReply, page: Page): FastifyReply {
  return page.kind === "html"
    ? sendHtml(reply, page.status, page.html, page.urls)
    : sendRedirect(reply, page.url);
}

export function sendHtml(
  reply: FastifyReply,
  status: number,
  html: string,
  redirectUrls: readonly string[] = [],
): FastifyReply {
  return reply
    .code(status)
    .headers(securityHeaders(redirectUrls))
    .type("text/html; charset=utf-8")
    .send(html);
}

/** Only ever to a URL the API caller supplied. */
export function sendRedirect(reply: FastifyReply, url: string): FastifyReply {
  return reply
    .code(303)
    .headers(securityHeaders([url]))
    .header("location", url)
    .send();
}

/** Path of the pages' base, so forms post to the same origin the browser used. */
export function basePath(config: PaySimConfig): string {
  try {
    return new URL(config.publicBaseUrl).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** HMAC of the page's own id, keyed by the server's secret. */
export function csrfToken(config: PaySimConfig, scope: string): string {
  return createHmac("sha256", `paysim-csrf:${config.secretKey}`).update(scope).digest("hex");
}

export function csrfValid(
  config: PaySimConfig,
  scope: string,
  presented: string | undefined,
): boolean {
  if (presented === undefined) return false;
  const want = Buffer.from(csrfToken(config, scope));
  const got = Buffer.from(presented);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function hiddenCsrf(config: PaySimConfig, scope: string): string {
  return `<input type="hidden" name="csrf" value="${esc(csrfToken(config, scope))}">`;
}
