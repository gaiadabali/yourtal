import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DEFAULT_API_VERSION } from "../config";
import { type Ctx, unix } from "../ctx";
import type { ParamObject } from "../form";
import { str } from "../params";
import type { PipelineDeps } from "../api/pipeline";
import { type BankScenario, completeOnboarding } from "../domain/connect";
import { load, nv, sv } from "../domain/repo";
import type { StoredObject } from "../store";
import {
  type Page,
  basePath,
  csrfValid,
  esc,
  hiddenCsrf,
  htmlPage,
  htmlResult,
  redirectResult,
  sendPage,
} from "./layout";
import { type Locale, type StringKey, type Translate, pickLocale, translator } from "./strings";

/** Stripe's documented AU test bank accounts, all under BSB 110000. */
const TEST_BANKS: Record<string, BankScenario> = {
  "000123456": "ok",
  "111111116": "no_account",
  "111111113": "account_closed",
};
const TEST_BSB = "110000";

const scopeOf = (token: string): string => `onboarding:${token}`;

interface Errors {
  name?: StringKey;
  account?: StringKey;
}

function fieldError(t: Translate, key: StringKey | undefined): string {
  return key === undefined ? "" : `<p class="err" role="alert">${esc(t(key))}</p>`;
}

function formHtml(deps: PipelineDeps, token: string, t: Translate, errors: Errors): string {
  const action = `${basePath(deps.config)}/connect/onboarding/${token}`;
  return `<h1>${esc(t("onboardingTitle", { merchant: deps.config.accountName }))}</h1>
<form method="post" action="${esc(action)}" autocomplete="off">
${hiddenCsrf(deps.config, scopeOf(token))}
<label for="legal_name">${esc(t("legalName"))}</label>
<input id="legal_name" name="legal_name" autocomplete="off" required maxlength="120">${fieldError(t, errors.name)}
<label for="bsb">${esc(t("bsb"))}</label>
<input id="bsb" name="bsb" inputmode="numeric" autocomplete="off" required>
<label for="account">${esc(t("accountNumber"))}</label>
<input id="account" name="account" inputmode="numeric" autocomplete="off" required>${fieldError(t, errors.account)}
<button type="submit">${esc(t("submit"))}</button>
</form>`;
}

function bodyOf(req: FastifyRequest): ParamObject {
  const b: unknown = req.body;
  return typeof b === "object" && b !== null ? (b as ParamObject) : {};
}

export function registerOnboardingPages(app: FastifyInstance, deps: PipelineDeps): void {
  async function serve(
    req: FastifyRequest,
    reply: FastifyReply,
    fn: (ctx: Ctx, link: StoredObject | undefined, locale: Locale, token: string) => Promise<Page>,
  ): Promise<FastifyReply> {
    const token = (req.params as { token: string }).token;
    const header = req.headers["accept-language"];
    const locale = pickLocale(null, typeof header === "string" ? header : undefined);
    const page = await deps.store.transaction(async (tx) => {
      const found = await tx.get(token, { forUpdate: true });
      const link = found?.type === "account_link" ? found : undefined;
      const ctx: Ctx = {
        tx,
        now: deps.now(),
        config: deps.config,
        apiVersion: DEFAULT_API_VERSION,
        idempotencyKey: null,
        account: null,
      };
      return fn(ctx, link, locale, token);
    });
    return sendPage(reply, page);
  }

  /** Expired or already used: back to the caller's `refresh_url`, as Stripe does. */
  function stale(ctx: Ctx, link: StoredObject): Page | undefined {
    const gone = nv(link.data, "expires_at") <= unix(ctx.now) || link.internal["used"] === true;
    return gone ? redirectResult(sv(link.internal, "refresh_url")) : undefined;
  }

  function notFound(locale: Locale): Page {
    const t = translator(locale);
    return htmlResult(
      404,
      htmlPage({
        locale,
        title: t("notFound"),
        banner: t("bannerOnboarding"),
        body: `<h1>${esc(t("notFound"))}</h1>`,
      }),
    );
  }

  function formPage(link: StoredObject, locale: Locale, token: string, errors: Errors): Page {
    const t = translator(locale);
    const html = htmlPage({
      locale,
      title: t("onboardingTitle", { merchant: deps.config.accountName }),
      banner: t("bannerOnboarding"),
      body: formHtml(deps, token, t, errors),
    });
    return htmlResult(200, html, [
      sv(link.internal, "return_url"),
      sv(link.internal, "refresh_url"),
    ]);
  }

  app.get("/connect/onboarding/:token", (req, reply) =>
    serve(req, reply, (ctx, link, locale, token) => {
      if (link === undefined) return Promise.resolve(notFound(locale));
      return Promise.resolve(stale(ctx, link) ?? formPage(link, locale, token, {}));
    }),
  );

  app.post("/connect/onboarding/:token", (req, reply) =>
    serve(req, reply, async (ctx, link, locale, token) => {
      const body = bodyOf(req);
      if (!csrfValid(deps.config, scopeOf(token), str(body, "csrf"))) {
        return notFound(locale);
      }
      if (link === undefined) return notFound(locale);
      const gone = stale(ctx, link);
      if (gone !== undefined) return gone;

      const errors: Errors = {};
      const name = (str(body, "legal_name") ?? "").trim();
      if (name === "" || name.length > 120) errors.name = "nameRequired";
      const bsb = (str(body, "bsb") ?? "").replace(/[\s-]/g, "");
      const account = (str(body, "account") ?? "").replace(/[\s-]/g, "");
      const scenario = bsb === TEST_BSB ? TEST_BANKS[account] : undefined;
      if (scenario === undefined) errors.account = "bankRefused";
      if (errors.name !== undefined || errors.account !== undefined || scenario === undefined) {
        return formPage(link, locale, token, errors);
      }
      const acct = await load(ctx, sv(link.internal, "account"), "account", { lock: true });
      await completeOnboarding(ctx, acct, {
        scenario,
        last4: account.slice(-4),
        routing: TEST_BSB,
      });
      link.internal["used"] = true;
      await ctx.tx.put(link);
      return redirectResult(sv(link.internal, "return_url"));
    }),
  );
}
