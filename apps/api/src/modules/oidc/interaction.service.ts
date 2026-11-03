import type { IncomingMessage, ServerResponse } from "node:http";
import { Inject, Injectable } from "@nestjs/common";
import { errors } from "oidc-provider";
import type Provider from "oidc-provider";
import type {
  AccessDeniedReason,
  InteractionDetails,
  InteractionRedirect,
  SignInRefusal,
} from "@yourtal/contracts/oidc/interaction";
import { currentPolicyVersion } from "@yourtal/consent/policy-version";
import type { SessionSignIn } from "../auth/session/session.service";
import type { OidcAccount } from "./claims";
import type { SignInClient } from "./clients";
import { clientById, isSignInClient } from "./clients";
import { OIDC_RUNTIME, OidcRuntime } from "./oidc-runtime";
import type { OidcStore } from "./oidc-store";
import type { SignInState, TeenInviteChecker } from "./sign-in-checks";
import { TEEN_INVITE_CHECKER, decideSignIn, signInTooOld } from "./sign-in-checks";

/** YourTal's session, with how and when the person signed in to it (`SessionService`). */
export interface SignInSessions {
  validateWithSignIn(token: string, now: Date): Promise<SessionSignIn>;
}
export const SIGN_IN_SESSIONS = Symbol("SIGN_IN_SESSIONS");

/** The signed-in person, and the sign-in that the ID token's `auth_time` and `amr` describe. */
interface SignedIn {
  readonly account: OidcAccount;
  readonly authTime: Date;
  readonly amr: readonly string[];
}

export type InteractionErrorCode =
  "interaction_not_found" | "session_required" | "screen_changed" | "sign_in_refused";

export class InteractionError extends Error {
  constructor(
    readonly code: InteractionErrorCode,
    readonly refusal?: SignInRefusal,
  ) {
    super(code);
  }
}

/** The raw request and response, which the provider reads its interaction cookies from. */
export interface RawHttp {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
}

interface Loaded {
  readonly provider: Provider;
  readonly store: OidcStore;
  readonly uid: string;
  readonly client: SignInClient;
  readonly scopes: string[];
  readonly prompts: Set<string>;
  readonly params: Record<string, unknown>;
  /** When the provider started this interaction, epoch seconds. */
  readonly startedAt: number;
}

function words(value: unknown): string[] {
  return typeof value === "string" ? value.split(" ").filter((word) => word.length > 0) : [];
}

/**
 * The interaction API behind `/connect/[uid]` (docs/26 §1.1, §1.5). The page's
 * server forwards the browser's interaction cookies and YourTal session; the
 * provider ties the cookie to this sign-in, so a uid alone opens nothing.
 */
@Injectable()
export class InteractionService {
  constructor(
    @Inject(OIDC_RUNTIME) private readonly runtime: OidcRuntime,
    @Inject(SIGN_IN_SESSIONS) private readonly sessions: SignInSessions,
    @Inject(TEEN_INVITE_CHECKER) private readonly teenInvites: TeenInviteChecker,
  ) {}

  async details(http: RawHttp, uid: string, sessionToken: string): Promise<InteractionDetails> {
    const loaded = await this.load(http, uid);
    const { state } = await this.decide(loaded, sessionToken, new Date());
    const { client } = loaded;
    return {
      uid,
      screen: state.screen,
      client: {
        clientId: client.clientId,
        name: client.name,
        operator: client.operator,
        externalOperator: client.externalOperator,
        privacyUrl: client.privacyUrl,
        termsUrl: client.termsUrl,
        returnHost: client.returnHost,
      },
      account:
        "account" in state
          ? { name: state.account.displayName, email: state.account.email ?? "" }
          : null,
      sharing: "sharing" in state ? state.sharing : null,
      refusal: state.screen === "refused" ? state.refusal : null,
      inviteProblem: state.screen === "refused" ? state.inviteProblem : null,
      teenInvite:
        "invite" in state && state.invite !== null ? { parentName: state.invite.parentName } : null,
      uiLocales: words(loaded.params["ui_locales"]),
    };
  }

  async continue(
    http: RawHttp,
    uid: string,
    sessionToken: string,
    tapped: "consent" | "continue",
  ): Promise<InteractionRedirect> {
    const loaded = await this.load(http, uid);
    const now = new Date();
    const { state, signedIn } = await this.decide(loaded, sessionToken, now);
    if (!("account" in state) || signedIn === null || state.screen === "sign_in_again") {
      throw new InteractionError("session_required");
    }
    if (state.screen === "verify_email") throw new InteractionError("screen_changed");
    if (state.screen === "refused") {
      await loaded.store.logSignIn(state.account.userId, loaded.client.clientId, state.refusal);
      throw new InteractionError("sign_in_refused", state.refusal);
    }
    // Consent is only ever recorded from the consent screen itself.
    if (state.screen === "consent" && tapped !== "consent") {
      throw new InteractionError("screen_changed");
    }

    const { account } = state;
    if (state.screen === "consent") {
      const policyVersionId = currentPolicyVersion(account.region)?.id;
      if (policyVersionId === undefined)
        throw new Error("oidc: no consent wording for this region");
      const { invite } = state;
      const granted = await loaded.store.grantAppConsent({
        userId: account.userId,
        sector: loaded.client.sector,
        scopes: loaded.scopes,
        policyVersionId,
        jurisdiction: account.region,
        now,
        // A teen agrees under their guardian's invite, and a pending one is used up here.
        ...(invite === null ? {} : { invite: { id: invite.inviteId, accept: invite.pending } }),
      });
      if (!granted) {
        await loaded.store.logSignIn(
          account.userId,
          loaded.client.clientId,
          "teen_invite_required",
        );
        throw new InteractionError("sign_in_refused", "teen_invite_required");
      }
    }

    const grant = new loaded.provider.Grant({
      accountId: account.userId,
      clientId: loaded.client.clientId,
    });
    grant.addOIDCScope(loaded.scopes.join(" "));
    const grantId = await grant.save();

    const redirectTo = await loaded.provider.interactionResult(
      http.req,
      http.res,
      {
        // auth_time and amr are the YourTal session's own sign-in, not this tap.
        login: {
          accountId: account.userId,
          ts: Math.floor(signedIn.authTime.getTime() / 1000),
          amr: [...signedIn.amr],
          remember: false,
        },
        consent: { grantId },
        ...(loaded.prompts.has("create") ? { create: {} } : {}),
      },
      { mergeWithLastSubmission: false },
    );
    // The sign-in log row is written when the code is issued (provider-middleware.ts).
    return { redirectTo };
  }

  async cancel(http: RawHttp, uid: string, sessionToken: string): Promise<InteractionRedirect> {
    const loaded = await this.load(http, uid);
    const { state } = await this.decide(loaded, sessionToken, new Date());
    const reason: AccessDeniedReason =
      state.screen === "refused" ? state.refusal : "user_cancelled";
    const redirectTo = await loaded.provider.interactionResult(
      http.req,
      http.res,
      { error: "access_denied", error_description: reason },
      { mergeWithLastSubmission: false },
    );
    if ("account" in state) {
      await loaded.store.logSignIn(state.account.userId, loaded.client.clientId, reason);
    }
    return { redirectTo };
  }

  private async load(http: RawHttp, uid: string): Promise<Loaded> {
    const { provider, store } = this.runtime;
    if (provider === null || store === null) throw new InteractionError("interaction_not_found");
    let interaction: Awaited<ReturnType<Provider["interactionDetails"]>>;
    try {
      interaction = await provider.interactionDetails(http.req, http.res);
    } catch (error) {
      if (error instanceof errors.SessionNotFound)
        throw new InteractionError("interaction_not_found");
      throw error;
    }
    // The cookie names the sign-in; the page address must name the same one.
    if (interaction.uid !== uid) throw new InteractionError("interaction_not_found");

    const params: Record<string, unknown> = { ...interaction.params };
    const client = clientById(this.runtime.clients, String(params["client_id"]));
    if (client === undefined || !isSignInClient(client)) {
      throw new InteractionError("interaction_not_found");
    }
    return {
      provider,
      store,
      uid,
      client,
      scopes: words(params["scope"]),
      prompts: new Set(words(params["prompt"])),
      params,
      startedAt: interaction.iat,
    };
  }

  private async decide(
    loaded: Loaded,
    sessionToken: string,
    now: Date,
  ): Promise<{ state: SignInState; signedIn: SignedIn | null }> {
    const signedIn = await this.signedIn(loaded.store, sessionToken, now);
    const account = signedIn?.account ?? null;
    const inviteCode = loaded.params["teen_invite"];
    const maxAge = loaded.params["max_age"];
    const state = await decideSignIn({
      account,
      client: loaded.client,
      scopes: loaded.scopes,
      prompts: loaded.prompts,
      consent:
        account === null
          ? null
          : await loaded.store.findAppConsent(account.userId, loaded.client.sector),
      policyVersionId: account === null ? undefined : currentPolicyVersion(account.region)?.id,
      teenInviteCode: typeof inviteCode === "string" ? inviteCode : undefined,
      teenInvites: this.teenInvites,
      signInAgain:
        signedIn !== null &&
        signInTooOld({
          authTime: signedIn.authTime,
          interactionStartedAt: loaded.startedAt,
          prompts: loaded.prompts,
          // The library has checked it is a whole number of seconds.
          maxAge: maxAge === undefined ? undefined : Number(maxAge),
          now,
        }),
      now,
    });
    return { state, signedIn };
  }

  private async signedIn(
    store: OidcStore,
    sessionToken: string,
    now: Date,
  ): Promise<SignedIn | null> {
    if (sessionToken.length === 0) return null;
    const session = await this.sessions.validateWithSignIn(sessionToken, now);
    if (!session.valid) return null;
    const account = await store.findAccount(session.userId);
    return account === null ? null : { account, authTime: session.authTime, amr: session.amr };
  }
}
