import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DEFAULT_API_VERSION } from "../config";
import type { Ctx } from "../ctx";
import type { ParamObject } from "../form";
import { str } from "../params";
import type { PipelineDeps } from "../api/pipeline";
import { expireIfDue, attemptCard, pendingCard, resolveThreeDS } from "../domain/checkout";
import { aud } from "../domain/money";
import { jo, nv, sn, sv } from "../domain/repo";
import type { StoredObject } from "../store";
import { type CardFormErrors, checkCard } from "./card-input";
import {
  basePath,
  csrfValid,
  esc,
  hiddenCsrf,
  htmlPage,
  htmlResult,
  redirectResult,
  sendPage,
  type Page,
} from "./layout";
import { type Locale, type StringKey, type Translate, pickLocale, translator } from "./strings";

const scopeOf = (id: string): string => `checkout:${id}`;

function bodyOf(req: FastifyRequest): ParamObject {
  const b: unknown = req.body;
  return typeof b === "object" && b !== null ? (b as ParamObject) : {};
}

function localeOf(s: StoredObject | undefined, req: FastifyRequest): Locale {
  const header = req.headers["accept-language"];
  return pickLocale(
    s === undefined ? null : sn(s.data, "locale"),
    typeof header === "string" ? header : undefined,
  );
}

function redirectUrls(s: StoredObject): string[] {
  return [sn(s.data, "success_url"), sn(s.data, "cancel_url")].filter(
    (u): u is string => u !== null,
  );
}

/** `{CHECKOUT_SESSION_ID}` is replaced with the session id, as at Stripe. */
function successTarget(s: StoredObject): string {
  return sv(s.data, "success_url")
    .split("{CHECKOUT_SESSION_ID}")
    .join(s.id)
    .split("%7BCHECKOUT_SESSION_ID%7D")
    .join(s.id);
}

function fieldError(t: Translate, msg: StringKey | undefined): string {
  return msg === undefined ? "" : `<p class="err" role="alert">${esc(t(msg))}</p>`;
}

function formHtml(
  deps: PipelineDeps,
  s: StoredObject,
  t: Translate,
  opts: { errors?: CardFormErrors; topError?: string },
): string {
  const payment = sv(s.data, "mode") === "payment";
  const item = jo(s.internal, "line_item");
  const amount = nv(s.data, "amount_total");
  const action = `${basePath(deps.config)}/checkout/${s.id}`;
  const title = payment
    ? t("payTo", { merchant: deps.config.accountName })
    : t("saveCardTitle", { merchant: deps.config.accountName });
  const sub = payment
    ? `<p class="sub">${esc(sv(item, "name"))} &middot; ${esc(t("quantity", { n: String(nv(item, "quantity")) }))} &middot; ${esc(aud(amount))} AUD</p>`
    : "";
  const cancel =
    sn(s.data, "cancel_url") === null
      ? ""
      : `<p><a href="${esc(`${action}/cancel`)}">${esc(t("back"))}</a></p>`;
  const e = opts.errors ?? {};
  return `<h1>${esc(title)}</h1>${sub}
${opts.topError === undefined ? "" : `<p class="top-err" role="alert">${esc(opts.topError)}</p>`}
<form method="post" action="${esc(action)}" autocomplete="off">
${hiddenCsrf(deps.config, scopeOf(s.id))}
<label for="number">${esc(t("cardNumber"))}</label>
<input id="number" name="number" inputmode="numeric" autocomplete="off" required>${fieldError(t, e.number)}
<label for="expiry">${esc(t("expiry"))}</label>
<input id="expiry" name="expiry" inputmode="numeric" autocomplete="off" placeholder="MM / YY" required>${fieldError(t, e.expiry)}
<label for="cvc">${esc(t("cvc"))}</label>
<input id="cvc" name="cvc" inputmode="numeric" autocomplete="off" required>${fieldError(t, e.cvc)}
<button type="submit">${esc(payment ? t("pay", { amount: `${aud(amount)} AUD` }) : t("saveCard"))}</button>
</form>${cancel}`;
}

function message(t: Translate, locale: Locale, key: "expired" | "complete" | "notFound"): string {
  return htmlPage({
    locale,
    title: t(key),
    banner: t("bannerPayment"),
    body: `<h1>${esc(t(key))}</h1>`,
  });
}

function threeDsHtml(deps: PipelineDeps, s: StoredObject, t: Translate): string {
  const action = `${basePath(deps.config)}/checkout/${s.id}/3ds`;
  const csrf = hiddenCsrf(deps.config, scopeOf(s.id));
  return `<h1>${esc(t("threeDsTitle"))}</h1><p class="sub">${esc(t("threeDsBody"))}</p>
<form method="post" action="${esc(action)}">${csrf}
<button type="submit" name="outcome" value="complete">${esc(t("threeDsComplete"))}</button>
<button class="secondary" type="submit" name="outcome" value="fail">${esc(t("threeDsFail"))}</button>
</form>`;
}

export function registerCheckoutPages(app: FastifyInstance, deps: PipelineDeps): void {
  const base = (): string => basePath(deps.config);

  /** Runs `fn` in one transaction, then sends the page it chose. */
  async function serve(
    req: FastifyRequest,
    reply: FastifyReply,
    fn: (ctx: Ctx, s: StoredObject | undefined, locale: Locale) => Promise<Page>,
  ): Promise<FastifyReply> {
    const id = (req.params as { id: string }).id;
    const page = await deps.store.transaction(async (tx) => {
      const found = await tx.get(id, { forUpdate: true });
      const s = found?.type === "checkout.session" ? found : undefined;
      const ctx: Ctx = {
        tx,
        now: deps.now(),
        config: deps.config,
        apiVersion: DEFAULT_API_VERSION,
        idempotencyKey: null,
        account: null,
      };
      return fn(ctx, s, localeOf(s, req));
    });
    return sendPage(reply, page);
  }

  /** The page for a session that is not open, or undefined when it is. */
  async function closedPage(
    ctx: Ctx,
    s: StoredObject | undefined,
    locale: Locale,
  ): Promise<Page | undefined> {
    const t = translator(locale);
    if (s === undefined) return htmlResult(404, message(t, locale, "notFound"));
    if (await expireIfDue(ctx, s)) {
      return htmlResult(410, message(t, locale, "expired"), redirectUrls(s));
    }
    if (sv(s.data, "status") === "complete") {
      return htmlResult(200, message(t, locale, "complete"), redirectUrls(s));
    }
    return undefined;
  }

  function formPage(
    s: StoredObject,
    locale: Locale,
    opts: { errors?: CardFormErrors; topKey?: "declined" | "authFailed" },
  ): Page {
    const t = translator(locale);
    const html = htmlPage({
      locale,
      title: t("payTo", { merchant: deps.config.accountName }),
      banner: t("bannerPayment"),
      body: formHtml(deps, s, t, {
        ...(opts.errors === undefined ? {} : { errors: opts.errors }),
        ...(opts.topKey === undefined ? {} : { topError: t(opts.topKey) }),
      }),
    });
    return htmlResult(200, html, redirectUrls(s));
  }

  function badCsrf(locale: Locale): Page {
    const t = translator(locale);
    const html = htmlPage({
      locale,
      title: t("expiredPage"),
      banner: t("bannerPayment"),
      body: `<h1>${esc(t("expiredPage"))}</h1>`,
    });
    return htmlResult(403, html);
  }

  app.get("/checkout/:id", (req, reply) =>
    serve(req, reply, async (ctx, s, locale) => {
      const closed = await closedPage(ctx, s, locale);
      if (closed !== undefined) return closed;
      if (s === undefined) return htmlResult(404, "");
      if (pendingCard(s) !== null) {
        return redirectResult(`${base()}/checkout/${s.id}/3ds`);
      }
      return formPage(s, locale, {});
    }),
  );

  app.post("/checkout/:id", (req, reply) =>
    serve(req, reply, async (ctx, s, locale) => {
      const body = bodyOf(req);
      const id = (req.params as { id: string }).id;
      if (!csrfValid(deps.config, scopeOf(id), str(body, "csrf"))) return badCsrf(locale);
      const closed = await closedPage(ctx, s, locale);
      if (closed !== undefined) return closed;
      if (s === undefined) return htmlResult(404, "");
      const check = checkCard(
        {
          number: str(body, "number") ?? "",
          expiry: str(body, "expiry") ?? "",
          cvc: str(body, "cvc") ?? "",
        },
        ctx.now,
      );
      if (!check.ok) return formPage(s, locale, { errors: check.errors });
      const result = await attemptCard(ctx, s, check.scenario, check.card);
      if (result === "declined") return formPage(s, locale, { topKey: "declined" });
      if (result === "needs_3ds") return redirectResult(`${base()}/checkout/${s.id}/3ds`);
      return redirectResult(successTarget(s));
    }),
  );

  app.get("/checkout/:id/3ds", (req, reply) =>
    serve(req, reply, async (ctx, s, locale) => {
      const closed = await closedPage(ctx, s, locale);
      if (closed !== undefined) return closed;
      if (s === undefined) return htmlResult(404, "");
      if (pendingCard(s) === null) return redirectResult(`${base()}/checkout/${s.id}`);
      const t = translator(locale);
      const html = htmlPage({
        locale,
        title: t("threeDsTitle"),
        banner: t("bannerPayment"),
        body: threeDsHtml(deps, s, t),
      });
      return htmlResult(200, html, redirectUrls(s));
    }),
  );

  app.post("/checkout/:id/3ds", (req, reply) =>
    serve(req, reply, async (ctx, s, locale) => {
      const body = bodyOf(req);
      const id = (req.params as { id: string }).id;
      if (!csrfValid(deps.config, scopeOf(id), str(body, "csrf"))) return badCsrf(locale);
      const closed = await closedPage(ctx, s, locale);
      if (closed !== undefined) return closed;
      if (s === undefined) return htmlResult(404, "");
      const outcome = str(body, "outcome");
      if (pendingCard(s) === null || (outcome !== "complete" && outcome !== "fail")) {
        return redirectResult(`${base()}/checkout/${s.id}`);
      }
      const result = await resolveThreeDS(ctx, s, outcome);
      if (result === "complete") return redirectResult(successTarget(s));
      return formPage(s, locale, { topKey: "authFailed" });
    }),
  );

  app.get("/checkout/:id/cancel", (req, reply) =>
    serve(req, reply, (_ctx, s, locale) => {
      const cancel = s === undefined ? null : sn(s.data, "cancel_url");
      if (cancel !== null) return Promise.resolve(redirectResult(cancel));
      const t = translator(locale);
      const html = htmlPage({
        locale,
        title: t("closeThis"),
        banner: t("bannerPayment"),
        body: `<h1>${esc(t("closeThis"))}</h1>`,
      });
      return Promise.resolve(htmlResult(s === undefined ? 404 : 200, html));
    }),
  );
}
