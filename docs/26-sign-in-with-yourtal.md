# YourTal — Sign in with YourTal: the account contract

**Date:** 2026-10-20 · **Status:** Proposed, for the lead's review. Written for group task 3.2 (YourTal 14.4). The founder's open choices are in §6; until they are answered, the build uses the recommended option.
**Builds on:** F99, F102 and F105 ([`16`](16-decisions.md) § V), F2 (region walls), F88 (escrow on deletion), [`14`](14-security-engineering.md) §3 and §5.
**Feeds:** group tasks 3.3 (SnapApp), 3.5 (Free Tax Returns), 3.6, 3.7, 3.9 (YourTal as provider) and 3.10 (teen invites).

YourTal becomes an OpenID Connect provider. SnapApp and Free Tax Returns (FTR) send people to YourTal to sign in, and get back a small, fixed set of facts: an identifier only that app sees, an email, a name, a region and an age band. Each app then runs its own session. When an account is deleted, or an app's access ends, YourTal tells the app with a signed event, and the app acts within set times. This document is the contract between the three: what each side may rely on, and what each side must do.

| Question | Choice                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| Library  | `oidc-provider` 9.x by panva, OpenID Certified, mounted in `apps/api` at `/oidc`                            |
| Issuer   | `https://yourtal.gaiada.com/oidc` on staging; the production address is §6 Q2                               |
| `sub`    | Pairwise: one random identifier per person per app, stored, never derived from YourTal's user id            |
| Claims   | `sub`, `email`, `email_verified`, `name`, `region`, `age_band`. Never the date of birth                     |
| Tokens   | Code 60 s, ID token 5 min, access token 10 min. No refresh tokens for any app in phase 3                    |
| Sessions | Each app keeps its own. YourTal is on the sign-in path only, so an outage stops new sign-ins, not open ones |
| Deletion | Signed Security Event Tokens pushed to each app, retried for 7 days, with alerts                            |
| Teens    | Refused by every app except SnapApp, and there only through an invite from the guardian who approved them   |

---

## 1. Claims, clients and tokens (14.4.a)

### 1.1 The provider

**Library: [`oidc-provider`](https://github.com/panva/node-oidc-provider) 9.x** (9.12.2 today). Recommended for four reasons:

1. **It is certified.** OpenID Certified for the Basic, Config, Form Post and 3rd Party-Init profiles, Back-Channel and RP-Initiated Logout, and FAPI 1.0 and 2.0. Every protocol piece here is the library's: discovery, authorize, token, userinfo, JWKS, PKCE, pairwise subjects, client credentials, the `iss` response parameter (RFC 9207), and refresh rotation and DPoP for later. Nothing in this document is hand-written protocol.
2. **It fits the stack.** It is ESM like `apps/api`, runs on Node 24, and documents mounting into Fastify, which is what NestJS runs on here.
3. **Its supply chain is small:** three runtime dependencies (`jose`, `koa`, `debug`), which matters under [`14`](14-security-engineering.md) §7.
4. **The alternatives break F99 or add a framework.** Zitadel, Keycloak and Ory Hydra are separate services with their own databases, and F99 rules out a separate identity service. Better Auth's OIDC plugin would bring a second auth framework into an app that has none, and it is not certified.

**Where it runs.** A new module, `apps/api/src/modules/oidc` (Area A), mounts the provider on the API's Fastify instance at `/oidc`. It shares the API's database, Redis, email driver and the person's YourTal session. Its routes are authenticated by the protocol itself (client authentication, PKCE, the interaction cookie), so the route registry declares them as protocol routes, and a test fails if anything else is mounted under `/oidc`.

**Issuer and discovery.** On staging the issuer is `https://yourtal.gaiada.com/oidc`, with discovery at `https://yourtal.gaiada.com/oidc/.well-known/openid-configuration`. nginx needs `location ^~ /oidc/` pointing at the API (port 26301): without `^~`, the vhost's `location ~ /.well-known` regex catches the discovery path and serves a 404 from the static root. If the issuer ever moves, every `sub` stays the same, so an app changes one setting and migrates no data.

**Screens.** The sign-in, consent and refusal screens are YourTal web pages in `apps/web` (`/connect/[uid]`, Area B), in YourTal's look, in en-AU and id-ID. They reach the API's interaction endpoints through the web server, as every other web page does, and finish by navigating the browser to the URL the provider returns. They never post a form to another origin, because the CSP has `form-action 'self'`.

**Settings that differ from the library's defaults** (each is a check in its ticket):

| Setting                                                                     | Default                                     | YourTal                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `features.devInteractions`                                                  | On: a test login that accepts anyone        | **Off in every build**                                                          |
| `responseTypes`                                                             | `code`, `id_token`, `code id_token`, `none` | `code` only, `query` response mode only                                         |
| `pkce.required`                                                             | Public clients only                         | **Every client**, `S256` only                                                   |
| `subjectTypes`                                                              | `public`                                    | `pairwise` only                                                                 |
| `clientAuthMethods`                                                         | Five methods                                | `private_key_jwt`, `client_secret_basic`, and `none` for the phone app only     |
| `conformIdTokenClaims`                                                      | `true`: scope claims only from userinfo     | `false`: the ID token carries the granted claims, so apps need no userinfo call |
| `ttl.IdToken`, `ttl.AccessToken`                                            | 1 hour each                                 | 5 min, 10 min                                                                   |
| `features.clientCredentials`                                                | Off                                         | On, for SnapApp's server only                                                   |
| Dynamic registration, request objects, back-channel and RP-initiated logout | Varies                                      | Off                                                                             |

### 1.2 The `sub`: pairwise, random and stored

**Choice: pairwise.** Each person gets a different `sub` in each app (a "sector"). SnapApp's website, phone app and server share one sector, so they see the same `sub`. FTR has its own.

Why pairwise rather than public:

- **FTR is run by another company.** A public `sub` would be a permanent key that lets Benjamin Charles Group and our group join their records about a person without YourTal and without the person. Purpose limits in the Privacy Act (APP 6) and UU PDP point the other way. The apps also share an email, but an email is consented, visible and changeable; a `sub` lasts forever.
- **Nothing needs a shared identifier.** When two apps must refer to the same person (group task 4.8, SnapApp sending a deduction bundle to FTR), YourTal brokers it: SnapApp's server asks YourTal for a short-lived token for FTR about that person (RFC 8693 token exchange, built in 4.8), and FTR checks it against its own `sub`. The link always goes through YourTal, with the person signed in.
- **YourTal's user id never leaves YourTal.** It is the join key into the ledger, whose rows are never deleted (F88), so no app should hold anything that joins into it.

**Random and stored, not derived.** `oidc.subject` holds `(sector, user_id, sub)`, created at the person's first sign-in to that app, and the provider's `pairwiseIdentifier` hook reads it. A hash of the user id with a secret salt would also work, but a stored random value has no secret to protect or rotate, is gone for good once erased (§2), and lets YourTal find the person from an app's `sub` (§3.3) with one indexed read.

**Format.** 22 characters of base64url (128 random bits). Apps treat it as opaque, case-sensitive text of up to 255 characters, and never parse it.

**Sectors** are named per app and environment (`snapapp-staging`, `ftr-staging`, later `snapapp` and `ftr`), so a staging database never holds a production identifier. Each client has one redirect host, so no `sector_identifier_uri` is needed; the hook reads the sector from YourTal's client registry (§1.9).

### 1.3 Claims

Every app may rely on these, and on nothing else.

| Claim            | Value                                                                           | Rely on it for                                                                       | Never                                                                                         |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `sub`            | The pairwise identifier (§1.2)                                                  | The one key to this person in your app                                               | Show it, share it, or compare it with another app's                                           |
| `email`          | Lower-case, verified address                                                    | Contact and display; matching an existing account **once**, at first sign-in (§1.10) | Look a person up by email after that, or treat it as permanent                                |
| `email_verified` | Always `true`: YourTal finishes no app sign-in for an unverified address (§1.5) | Confirming that one-time match                                                       | Skip the check because it is always true                                                      |
| `name`           | The display name the person chose, 1 to 120 characters                          | Display                                                                              | Treat it as a legal name, or show it unescaped                                                |
| `region`         | `AU` or `ID`                                                                    | Region rules (FTR is AU only, §1.5) and defaults such as tax rules                   | Expect it to change: a person who moves gets a new account ([`02`](02-architecture.md) §8)    |
| `age_band`       | `adult` or `teen`, computed when the token is issued                            | Teen rules (SnapApp's teen space)                                                    | Expect it to stay `teen`: it becomes `adult` on the 18th birthday, and YourTal says so (§2.2) |

The ID token also carries `iss`, `aud`, `azp`, `exp`, `iat`, `auth_time`, `nonce` (when the app sent one) and `amr`. `amr` says how the person signed in: `pwd` for a password, `hwk` for a passkey, `otp` for an authenticator code, and `mfa` when two were used. Apps may require `hwk` or `mfa` for staff (§1.10).

What `amr` does and does not promise (group 3.9.c):

- **Any passkey counts as `hwk`**, synced ones (iCloud Keychain, Google Password Manager, 1Password) included. RFC 8176 reserves `hwk` for a hardware-bound key; YourTal uses it for every passkey because what the staff rule needs is phishing resistance, which a synced passkey has too. YourTal accepts attestation `none`, so it cannot tell a device-bound key from a synced one, and does not try.
- **A password can add an account's first factor.** A recent password sign-in may add a passkey or an authenticator app to an account that has none, so someone holding a phished password can give themselves `hwk` or `mfa` on such an account. Once the account has a factor, adding another needs a session signed in with one (`hwk` or `mfa`) or a fresh step-up with one. The safeguards for the first factor are the email sent on every addition and removal, and a 72-hour window: a factor added from a password alone to an account with none is marked bootstrapped, and for 72 hours a session from a password reset (which proves the email address) can remove it, and a reset removes such an authenticator app outright instead of asking for its code. After 72 hours it is trusted like any other. Accepted risk: staff accounts in other apps should get their first passkey in a deliberate setup with the person, not rely on this; an app's "hwk or mfa" rule cannot tell a first factor planted with a phished password from the owner's own.
- **A password reset** emails the list of passkeys and apps that can still sign in.
- **`auth_time` is the last real sign-in.** A session minted to replace another (a password change) keeps the original's `auth_time` and `amr`.
- **Accepted for now:** someone who holds the password can spend the account's five wrong-code attempts per 15 minutes and so keep the real person from finishing a password-and-code sign-in for that time. A passkey sign-in is not affected.

**Never shared:** the date of birth, the guardian's email or identity, password and passkey data, the points balance, the trust tier, watch history and YourTal's user id.

An ID token for SnapApp's website, decoded:

```json
{
  "iss": "https://yourtal.gaiada.com/oidc",
  "sub": "q8mE3s0dW9xYbVvLr2H4tA",
  "aud": "snapapp-staging-web",
  "azp": "snapapp-staging-web",
  "iat": 1792800000,
  "exp": 1792800300,
  "auth_time": 1792799950,
  "nonce": "n-0S6_WzA2Mj",
  "amr": ["pwd"],
  "email": "ana@example.com",
  "email_verified": true,
  "name": "Ana",
  "region": "AU",
  "age_band": "adult"
}
```

### 1.4 Scopes and consent

| Scope          | Gives                      | Who may ask                                                     |
| -------------- | -------------------------- | --------------------------------------------------------------- |
| `openid`       | `sub`                      | Every sign-in client                                            |
| `email`        | `email`, `email_verified`  | Every sign-in client                                            |
| `profile`      | `name`                     | Every sign-in client                                            |
| `account`      | `region`, `age_band`       | Every sign-in client, and required: every app's rules need both |
| `teen_invites` | The teen invite API (§3.3) | SnapApp's server only, by client credentials                    |

Each client has an allowlist, and a scope outside it is refused, not silently dropped. No scope can grant, spend or read points: receipts keep the partner API and its own credential (group task 2.5), as [`14`](14-security-engineering.md) §5 requires.

**Consent is per app, not per client.** Agreeing on SnapApp's website covers SnapApp's phone app. YourTal asks the first time a person signs in to an app, and again only when:

- the app asks for a scope the person has not agreed to (`prompt=consent` on expansion, [`14`](14-security-engineering.md) §5);
- the consent wording changes materially (a new policy version in `@yourtal/consent`);
- a teen turns 18: a guardian's invite agreed for them, so the adult now agrees for themselves (§2.2).

At every other sign-in YourTal shows a one-tap "Continue to SnapApp as Ana" screen, so no sign-in completes without the person seeing which app and which account. There is no silent sign-in: `prompt=none` answers `login_required`. YourTal's own session (`yt_session`, 30 days idle) is the single sign-on session. Signing out of YourTal ends "Continue as" for every app, and signs the person out of no app.

**Records.** `oidc.app_consent` holds what each person currently shares with each app. Each grant and each withdrawal also appends a row to `identity.consent_record`, with purpose `sister_app_profile_sharing`, source `oidc_consent_screen` or the new `guardian_invite`, and a new `audience` column naming the app. That table is the append-only evidence, kept on deletion under its existing basis.

### 1.5 Who may sign in where

After the person proves who they are, and before any code is issued, YourTal checks these in order. A refusal shows a YourTal screen (§3.4) whose "Back to {app}" button returns `error=access_denied`, with an `error_description` the app can map to its own message.

| #   | Check                                                                                                                         | Fails with                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | The email is verified. If not, YourTal verifies it in the same flow and continues                                             | —                                          |
| 2   | The account is not suspended                                                                                                  | `account_on_hold`                          |
| 3   | The app accepts the person's region: SnapApp takes AU and ID, FTR takes AU only (§6 Q3)                                       | `region_not_supported`                     |
| 4   | Adults pass. Teens: FTR and every other app refuse them; SnapApp needs an active invite and guardian consent `granted` (§3.3) | `teen_not_allowed`, `teen_invite_required` |
| 5   | Consent covers the requested scopes; if not, the consent screen                                                               | `user_cancelled`                           |

Each app repeats checks 3 and 4 against the claims, as defence in depth, and refuses if they disagree.

### 1.6 Tokens and lifetimes

| Item                     | Lifetime               | Notes                                                              |
| ------------------------ | ---------------------- | ------------------------------------------------------------------ |
| Authorization code       | 60 s, one use          | A second use revokes what the first issued (the library does this) |
| ID token                 | 5 min                  | Read once, at sign-in                                              |
| Access token             | 10 min                 | Opaque, good only for userinfo. Apps do not need it                |
| Client-credentials token | 10 min                 | SnapApp's server, scope `teen_invites`                             |
| Refresh token            | **None in phase 3**    | No client is registered for `refresh_token` or `offline_access`    |
| Sign-in screen           | 1 hour                 | The provider's interaction                                         |
| App consent              | Until removed          | §1.4                                                               |
| YourTal session          | 30 days idle, as today | The single sign-on session                                         |

**Why no refresh tokens.** Apps sign a person in once and then run their own sessions: SnapApp's (group task 1.2.c) and FTR's Better Auth session. In phase 3 no app calls YourTal on a person's behalf, so a long-lived YourTal token outside YourTal would be a liability with no use. It also keeps YourTal off every request: if YourTal is down, people already signed in to an app stay signed in, and only new sign-ins wait. Revocation reaches apps as events (§2), not through token expiry.

**When an app later needs them** (for example a `points:read` scope to show the balance): they rotate on every use; reusing a spent one revokes the whole family, forces a new sign-in and raises a P2 alert ([`14`](14-security-engineering.md) §5); they last 30 days idle and 90 days at most; and a public client only gets DPoP-bound ones.

This refines group task 3.3.c: the phone app keeps **SnapApp's** refresh token in secure storage, not YourTal's.

### 1.7 Protocol rules

- **Authorization code flow only,** with `state` and PKCE `S256` on every request from every client. Apps also send `nonce` where their library supports it (openid-client does; Better Auth 1.6 does not, and PKCE covers code injection there).
- **The `iss` response parameter** (RFC 9207) is on every authorization response, and apps check it: openid-client always does, and Better Auth does with `requireIssuerValidation: true`.
- **Redirect URIs match exactly,** character for character: no wildcards, no prefixes, no extra path or query, no fragments, and one redirect host per client. Websites use `https` only. No staging or production client has an `http` or `localhost` address; a developer's local client lives only in local config. The phone app uses a private-use scheme in reverse-DNS form (RFC 8252 §7.1).
- **Errors raised before the client and redirect URI are confirmed** (an unknown client, a wrong redirect URI) are shown on a YourTal page and never redirected, so YourTal cannot serve as an open redirect.
- **Client authentication:** `private_key_jwt` where the app's library supports it (SnapApp, through openid-client); `client_secret_basic` where it does not (FTR: Better Auth 1.6 offers basic or post only); `none` for the phone app, which relies on PKCE.
- **Codes are redeemed on servers.** No browser calls YourTal's token or userinfo endpoints, so CORS on them stays closed. SnapApp's phone app hands its code to SnapApp's server (§1.9).
- **Signing:** RS256 for ID tokens and events. Encrypted tokens, request objects and `form_post` are off.
- **Language:** apps send `ui_locales` (FTR sends `en-AU`). YourTal's screens follow it, then the person's own language.
- **Sign-up from an app:** the app may send `prompt=create` (OpenID Connect "Initiating User Registration") to open YourTal's sign-up form instead of sign-in. The person registers, verifies their email without losing their place, and returns to the app.

### 1.8 Signing keys

- **RS256 with RSA 2048-bit keys,** in a JWKS file at `/opt/yourtal/secrets/oidc/jwks.json` (mode 0400, owner `uyourtal`), loaded at boot. Never in `app.env`: [`14`](14-security-engineering.md) §3 keeps signing keys out of environment variables. The provider's cookie-signing keys sit beside it. When the deployment moves to Cloud KMS, signing moves into it.
- **Rotation every 90 days with overlap** ([`14`](14-security-engineering.md) §3). Day 0: add the next key, published but unused. Day 7: it becomes the signing key. Day 14: the old key is removed. A script does each step, followed by a reload.
- **Emergency rotation:** remove the compromised key and reload. Apps re-fetch the JWKS when they meet an unknown `kid` (at most once a minute) and never pin a key.
- Every token and event carries a `kid`. The JWKS is cacheable for 10 minutes and discovery for 1 hour.

### 1.9 The clients

Clients are registered statically in `apps/api/src/modules/oidc/clients.ts`, reviewed in a pull request; there is no dynamic registration. Secrets and public keys are read from `/opt/yourtal/secrets/oidc/`. Each client also carries YourTal's own fields: `sector`, `teens` (`refuse` or `invite_only`), `regions`, `operator` (the company named on the consent screen) and, for receivers, `events_endpoint`.

| Client id                | What                           | Type and authentication                  | Redirect URI                                                     | Grants             | Teens       | Regions | Events go to                                         |
| ------------------------ | ------------------------------ | ---------------------------------------- | ---------------------------------------------------------------- | ------------------ | ----------- | ------- | ---------------------------------------------------- |
| `snapapp-staging-web`    | SnapApp website                | Web, confidential, `private_key_jwt`     | `https://snap-apps.gaiada.com/auth/yourtal/callback`             | Code               | Invite only | AU, ID  | The server client                                    |
| `snapapp-staging-mobile` | SnapApp phone app              | Native, public, `none`                   | `au.com.snapapps.app:/oauth/yourtal`                             | Code               | Invite only | AU, ID  | The server client                                    |
| `snapapp-staging-server` | SnapApp server                 | Machine, `private_key_jwt`               | None                                                             | Client credentials | —           | —       | `https://snap-apps-api.gaiada.com/v1/yourtal/events` |
| `ftr-web`                | FTR at `freetaxreturns.com.au` | Web, confidential, `client_secret_basic` | `https://freetaxreturns.com.au/api/auth/oauth2/callback/yourtal` | Code               | Refuse      | AU      | `https://freetaxreturns.com.au/api/yourtal/events`   |

The three SnapApp clients share the `snapapp-staging` sector. FTR has no staging site, so `ftr-web` (sector `ftr`) is registered now, on `freetaxreturns.com.au` behind FTR's own switch, which stays off for real users until §6 Q1 allows them (F124). SnapApp's production clients follow once SnapApp has a production domain. The Expo web export (`snap-apps-app.gaiada.com`) gets no client of its own; people sign in on the website.

**How SnapApp signs people in.** All protocol work sits in SnapApp's API server, using `openid-client`:

1. The website or the phone app asks the server to start (`POST /v1/auth/yourtal/start`, saying `web` or `mobile`, plus the invite when there is one). The server builds the authorization URL with `state`, `nonce` and a PKCE verifier, keeps them in a 10-minute flow row, and returns the URL and a flow id.
2. The website redirects to it. The phone app opens it with `expo-web-browser`'s `openAuthSessionAsync`: the system browser, never a WebView.
3. YourTal returns `code`, `state` and `iss` to the redirect URI, and the website or app passes them to `POST /v1/auth/yourtal/finish` with the flow id.
4. The server redeems the code (as the web client with its key, or as the public phone client), verifies the ID token, links or creates the user (§1.10) and issues a SnapApp session.

YourTal tokens never reach the browser or the phone. FTR does the same inside its own server through Better Auth's `genericOAuth` (§5).

### 1.10 What an app stores, and what it must not

**Must store:** the `sub`, as the only key to the person (unique and not null; SnapApp's `users.subject` already is), and a copy of `email` and `name` for contact and display, refreshed from the ID token at every sign-in. Nothing else from YourTal goes on the user record. An app reads `age_band` and `region` from the ID token at each sign-in and acts on them there: SnapApp records a teen in the teen space it creates (§3.3) and uses `region` as the default for a new workspace. YourTal's latest value always wins.

**Must not:**

- keep YourTal tokens after sign-in (FTR strips them before Better Auth writes its `account` row);
- ask for, infer or store a date of birth from YourTal (FTR's own date of birth on a tax return is FTR's data, for FTR's purpose);
- look a person up by email to sign them in, once they have signed in with YourTal;
- link a second YourTal `sub` to an account that already has one. A second `sub` with the same email can only follow a missed deletion event; it goes to the manual review list (group task 3.6.c) and is never linked;
- keep a sign-in method of its own beside YourTal for a linked account. Passwords, magic links, Google, SMS and email codes retire (group tasks 3.3.d and 3.5.e), because a weaker door beside YourTal defeats its passkeys. Recommended: the app's own sign-in goes the day YourTal sign-in arrives. If an app keeps it for a while, it works only for accounts not yet linked;
- treat the email copy as unique. If a refresh would collide with another account's copy, keep the old copy and flag it for review.

**First YourTal sign-in by an existing app user** (group task 3.6.e). The app links its existing account to the `sub` when, and only when, all three hold: the ID token says `email_verified: true`; the existing account has the same email; and that account has never been linked to a YourTal `sub`. YourTal's verification proves the mailbox, so this holds even where the app never verified the email itself, which is most FTR accounts. Otherwise the app creates a new account, or, when the email belongs to an already linked account, sends the case to review.

**Staff.** Roles stay in each app (group task 3.5.d). FTR staff lose SMS codes, so a staff sign-in must have `amr` containing `hwk` or `mfa`. The app refuses one without it and tells the person to add a passkey in YourTal. Passkeys (group task 3.9.c) must be live before staff move.

---

## 2. When an account is deleted or access ends (14.4.b)

### 2.1 Three ways to tell an app, and the choice

|                       | Back-channel logout                                                                     | Signed event, pushed                                      | Poll                                                                      |
| --------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| What it says          | "This YourTal session ended"                                                            | "Deleted", "access ended", "turned 18": one type per fact | Whatever the app asks                                                     |
| Fit                   | Poor: it is about sessions, the apps keep their own, and it carries no deletion meaning | Exact                                                     | Good                                                                      |
| Retries               | No delivery guarantee in the specification                                              | YourTal retries for 7 days; the app de-duplicates         | The app's poller retries                                                  |
| Speed                 | Seconds                                                                                 | Seconds                                                   | The poll interval                                                         |
| Who notices a failure | Nobody                                                                                  | YourTal, at every failed attempt                          | Nobody: a stopped poller looks like no news ([`16`](16-decisions.md) S-1) |
| Work for each app     | An endpoint                                                                             | An endpoint and a small inbox                             | A scheduler, a cursor and a job; FTR has no queue, only a host cron       |

**Choice: signed events, pushed.** Each event is a Security Event Token (SET, RFC 8417) delivered by HTTP POST (RFC 8935). A SET is a JWT signed with YourTal's OIDC keys, so apps verify it with the JWKS they already use for ID tokens. There is no shared webhook secret to hand out, store or rotate, and no app can forge an event for another. YourTal's merchant webhooks sign with a per-business HMAC secret, which suits merchants who hold no YourTal keys; every sign-in app already does.

### 2.2 The events

| Event type                          | Sent when                                                                          | Extra fields           | The app must                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `urn:yourtal:event:account-deleted` | The YourTal account is deleted: by the person, by the guardian's link, or by staff | —                      | End every session; erase the person's data (§2.6); never recreate this `sub` |
| `urn:yourtal:event:access-ended`    | The app can no longer sign this person in                                          | `reason`, `erase_data` | End every session; erase the data only when `erase_data` is `true`           |
| `urn:yourtal:event:became-adult`    | A teen who uses an app turns 18                                                    | —                      | SnapApp: end the parent's view of the space, keep the data, tell both        |

| `reason`            | Cause                                                           | `erase_data`                                                           |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `user_removed`      | An adult removed the app in Me → Linked apps                    | `false`: their app account stays, and they can come back by signing in |
| `security`          | Staff ended the person's app sessions after an account takeover | `false`                                                                |
| `guardian_withdrew` | The guardian withdrew consent on the guardian page              | `true`                                                                 |
| `parent_ended`      | The inviting parent ended the teen's access in SnapApp          | `true`                                                                 |
| `teen_removed`      | The teen removed SnapApp in Me → Linked apps                    | `true`                                                                 |
| `inviter_deleted`   | The inviting parent's YourTal account was deleted               | `true`                                                                 |

The teen rows follow §6 Q4's recommendation. An app acknowledges and ignores an event type it does not know.

YourTal has no email change today (`PATCH /api/me` changes only the display name and locale). When it is built, it must add a `profile-changed` event before it ships, because apps email people at the address they hold.

### 2.3 The wire format

```http
POST /v1/yourtal/events HTTP/1.1
Host: snap-apps-api.gaiada.com
Content-Type: application/secevent+jwt

eyJ0eXAiOiJzZWNldmVudCtqd3QiLCJhbGciOiJSUzI1NiIsImtpZCI6IjIwMjYtMTAtYSJ9.eyJpc3MiOi…
```

The protected header is `{"typ": "secevent+jwt", "alg": "RS256", "kid": "2026-10-a"}`, and the payload:

```json
{
  "iss": "https://yourtal.gaiada.com/oidc",
  "aud": "snapapp-staging-server",
  "iat": 1792800000,
  "jti": "5f0c6a3e-9d41-4f7e-8b2a-1c3d2e4f5a6b",
  "sub_id": {
    "format": "iss_sub",
    "iss": "https://yourtal.gaiada.com/oidc",
    "sub": "q8mE3s0dW9xYbVvLr2H4tA"
  },
  "events": {
    "urn:yourtal:event:access-ended": { "reason": "parent_ended", "erase_data": true }
  }
}
```

- `aud` is the receiving client, and `sub_id.sub` (RFC 9493) is that app's own `sub`, the same for all three SnapApp clients.
- One event per SET. `iat` is when the event happened; a retry resends the same `jti` and `iat`.
- A SET has no `exp` and no `nonce`, so it cannot pass as an ID token, and its `typ` stops an ID token passing as a SET (RFC 8725 explicit typing).

The app answers as RFC 8935 sets out:

| Answer                                                                                                                       | Meaning                              | YourTal then                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| `202 Accepted`                                                                                                               | Valid and stored, or already seen    | Marks it delivered                              |
| `400` with `{"err": "invalid_key"}`                                                                                          | The `kid` was not found              | Retries: the app may hold an old JWKS           |
| `400` with another `err` (`invalid_request`, `invalid_issuer`, `invalid_audience`, `authentication_failed`, `access_denied`) | Malformed, or not meant for this app | Stops and raises a P2 alert: one side has a bug |
| A timeout, `429`, `5xx` or any other status                                                                                  | Not stored                           | Retries                                         |

### 2.4 Sending (YourTal)

1. Every change that causes an event writes an outbox row **in the same transaction**: the deletion handler, a guardian's withdrawal, an invite ending, an app removal, and the daily job that already finds teens turning 18 to purge their guardian's email (`apps/worker/src/jobs/guardian-email-purge.ts`).
2. A worker job signs each row with the current key and posts it within a minute. Retries back off: 1, 5, 15 and 30 minutes, then hourly, for 7 days. Events for one person to one app go in order.
3. **Alerts:** an app failing for an hour pages staff (P3). An event still undelivered after 7 days, or refused with a non-retryable `400`, is a P2. Staff can resend from the console once the app is fixed.
4. Rows are purged 30 days after delivery. An outbox row holds the app's `sub`, the event and its delivery state, and nothing else personal.
5. Delivery is an external boundary under N-2: a `simulated` driver for development and CI, and a `live` one. Staging today refuses to boot unless every driver is simulated (YourTal task 2.3.b); like live email (group task 1.3), this boundary may run `live` on staging.

### 2.5 Receiving (every app)

1. Verify with `jose`, never by hand: the signature against YourTal's JWKS by `kid`; `typ` is `secevent+jwt`; `iss` is the configured issuer; `aud` is your client id; `iat` is at most 5 minutes ahead and at most 30 days old.
2. Store the event in an inbox keyed by `jti` (kept 30 days), answer `202` within 10 seconds, and act from a job. A `jti` already seen gets `202` and nothing more.
3. Act idempotently, keyed on `sub`. An unknown `sub` is a no-op. After `account-deleted`, later events for that `sub` are ignored.
4. Log the `jti`, the event type and the outcome, never the token.

### 2.6 What each app does, and by when

The clock starts when YourTal first delivers the event.

|             | Sessions end                                                       | Data erased                                                                                                                                                                                                                                                                            | Other                                                                   |
| ----------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **YourTal** | At once: today's deletion already erases every YourTal session     | In the same request: a new `connected_apps` data domain writes the events, then erases `oidc.subject`, `oidc.app_consent`, invites, the provider's grants and the sign-in log. Consent evidence stays under its existing basis                                                         | The delete screen says the apps are told (§3.5)                         |
| **SnapApp** | Within 5 minutes; this needs revocable sessions (group task 1.2.c) | Within 72 hours: personal workspaces and their files, memberships, the person's attribution in shared workspaces (set to null), mail records, then the user                                                                                                                            | `became-adult`: the parent's view ends within 1 hour, and both are told |
| **FTR**     | Within 5 minutes: delete the Better Auth sessions                  | Within 72 hours: the user and everything that cascades from it, and the rows keyed by email (leads, call requests, contact messages). Records the law makes FTR keep, such as referral payouts, stay, cut off from contact details where possible, and FTR's privacy policy lists them | —                                                                       |

72 hours (3×24) is the clock YourTal already plans its breach response to ([`03`](03-regulatory-and-risk.md) §2.3), reused here so one number covers both. Each app keeps a list of erased `sub` values, and nothing else about them, so a restore from backup can re-apply its deletions.

---

## 3. Consent wording (14.4.c)

### 3.1 Rules for the wording

- Short, plain sentences that say what happens, not how ([`12`](12-patterns-from-the-giants.md) on Google's consent screen).
- Name the company that runs the app, and the address the person goes back to.
- YourTal's screens come in en-AU and id-ID, from the next-intl catalogues. Copy never cites a ticket or a document.
- Points copy follows the house rule: "earn points", never "get paid" or "money".
- `{name}`, `{email}`, `{parent}`, `{teen}`, `{app}` and `{operator}` are filled in by the screen. The company names are §6 Q7.

### 3.2 Adults

**First sign-in to SnapApp**

> **Continue to SnapApp as {name}**
>
> {email} · Not you? Use another account
>
> SnapApp will get:
>
> - your name and email address
> - that you're 18 or over
> - that your YourTal account is for Australia
>
> It won't get your date of birth, your password or your points.
>
> SnapApp is run by {operator}. Its privacy policy explains how it uses your details. [Privacy policy] [Terms]
>
> You can remove SnapApp at any time in YourTal, under Me → Linked apps.
>
> [Continue] [Cancel]
>
> You'll go back to snap-apps.gaiada.com.

For an Indonesian account the third line reads "that your YourTal account is for Indonesia". If §6 Q6 is answered A, adults also see an unticked line: "Earn YourTal points for receipts you scan in SnapApp (1 point a receipt)", or 10 points in Indonesia.

**First sign-in to Free Tax Returns**

> **Continue to Free Tax Returns as {name}**
>
> {email} · Not you? Use another account
>
> Free Tax Returns will get:
>
> - your name and email address
> - that you're 18 or over
> - that your YourTal account is for Australia
>
> It won't get your date of birth, your password or your points.
>
> Free Tax Returns is run by {operator}, not by YourTal. Its privacy policy explains how it uses your details. [Privacy policy] [Terms]
>
> You can remove Free Tax Returns at any time in YourTal, under Me → Linked apps.
>
> [Continue] [Cancel]
>
> You'll go back to freetaxreturns.com.au.

**Every later sign-in**

> **Continue to {app} as {name}**
>
> {email} · Not you? Use another account
>
> [Continue] [Cancel]

**Signing in first** (no YourTal session yet)

> **Sign in to continue to {app}**
>
> {app} uses your YourTal account to sign you in.
>
> [Email] [Password] [Sign in] · [Sign in with a passkey]
>
> New to YourTal? [Create an account]

After a password sign-in, once: "Add a passkey? Next time you can sign in with your face, fingerprint or screen lock instead of a password." [Add a passkey] [Not now]

**Email not yet verified**

> **Check your email**
>
> We sent a link to {email}. Open it to confirm it's yours, then you'll go on to {app}.

### 3.3 Teens in SnapApp: the parent invite

**Who approves.** Only the guardian who approved the teen's YourTal account, by the guardian email link as today, can invite them. YourTal checks it when the teen accepts: the inviter has an adult YourTal account in the teen's region; its verified email equals the teen's approved guardian email (both normalised as YourTal stores them); and the guardian consent is `granted`. A guardian without a YourTal account first creates one with that same email. A teen cannot invite themselves, and nobody else's invite works.

**The flow.**

1. The parent, signed in to SnapApp, taps Family → Invite your teen. SnapApp's server calls YourTal's invite API with the parent's `sub`, and YourTal returns a one-time code (128 bits, kept only as a hash, valid 7 days).
2. SnapApp gives the parent a join link carrying the code, to send to the teen.
3. The teen opens it. SnapApp starts a normal sign-in (§1.9) and adds `teen_invite=<code>` to the authorization request.
4. The teen signs in to YourTal with their teen account. YourTal runs the checks above and shows the teen consent screen below.
5. When the teen taps Continue, YourTal records the consent (source `guardian_invite`), marks the invite used and returns to SnapApp.
6. SnapApp asks the invite API for the invite, checks that it is `accepted` and that its `teenSub` is the `sub` that just signed in, then creates the teen's own space and gives the inviting parent view access to it, and nothing more.

While the invite stands and the guardian consent holds, the teen signs in again with no new invite.

**The invite API.** SnapApp's server only. Like the partner API, the routes are public to Cerbos and a guard checks the credential first: here a client-credentials token for scope `teen_invites`, looked up in the provider in the same process.

| Call                                                 | Body                   | Answer                                                                                                          |
| ---------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST /api/oidc-clients/teen-invites`                | `{ "parentSub": "…" }` | `201 { "inviteId", "code", "expiresAt" }`, or `403 parent_not_eligible` when the parent is not a verified adult |
| `GET /api/oidc-clients/teen-invites/{inviteId}`      | —                      | `{ "status": "pending" \| "accepted" \| "expired" \| "ended", "teenSub" }`, with `teenSub` once accepted        |
| `POST /api/oidc-clients/teen-invites/{inviteId}/end` | `{ "parentSub": "…" }` | `200`. Ends the teen's access and sends `access-ended` with `parent_ended`                                      |

Each `POST` takes an `Idempotency-Key`, as elsewhere in the API, and a parent may create 10 invites a day.

**What the parent sees** in SnapApp before creating the link:

> **Invite your teen to SnapApp**
>
> Your teen can use SnapApp to keep track of their own spending. They sign in with their own YourTal account: the teen account you approved.
>
> - You'll be able to see everything in their SnapApp space: receipts, amounts and notes.
> - We'll tell them that you can see it.
> - They won't earn YourTal points for receipts.
> - You can end their access at any time. Ending it deletes their SnapApp space.
>
> [Create invite link]

Then: "Send this link to your teen. It works once, and only for the teen account you approved. It expires on {date}."

**What the teen is told**, on YourTal's teen consent screen:

> **Join SnapApp with {parent}'s invite**
>
> Signed in as {name} · {email}
>
> {parent} invited you to use SnapApp to keep track of your spending.
>
> - {parent} can see everything you add to SnapApp: receipts, amounts and notes.
> - SnapApp will get your name and email address, that you're under 18, and that your YourTal account is for Australia.
> - You won't earn YourTal points for receipts.
> - {parent} can end your access at any time. If they do, your SnapApp data is deleted.
>
> SnapApp is run by {operator}.
>
> [Continue] [Not now]

Inside SnapApp, always visible in the teen's space: "{parent} can see this space." In its settings: "Who can see my space: {parent}. They can see your receipts, amounts and notes."

When the teen joins, the parent sees: "{teen} joined SnapApp. You can see their space under Family."

**Ending access**, the parent in SnapApp:

> **End {teen}'s access to SnapApp?**
>
> {teen} won't be able to sign in to SnapApp, and their SnapApp space will be deleted, including their receipts. Download anything you want to keep first.
>
> [End access] [Cancel]

**Turning 18**, in SnapApp after `became-adult`. To the young adult: "You're 18 now, so this space is just yours. {parent} can't see it any more." The next time they sign in, YourTal shows them the adult consent screen. To the parent: "{teen} is 18 now, so you can no longer see their SnapApp space."

**The guardian page in YourTal** changes in two places. Its privacy line ("never shared with a business except as an anonymous total") adds: "The only exception is SnapApp, and only if you invite {name} there yourself." Withdrawing approval adds: "This also ends {name}'s access to SnapApp and deletes their SnapApp space."

### 3.4 Refusals

**A teen at Free Tax Returns**, and at any other app that refuses teens:

> **Free Tax Returns is for people 18 and over**
>
> Your YourTal account is a teen account, so you can't use it to sign in to Free Tax Returns. Nothing from your account was shared with Free Tax Returns.
>
> [Back to Free Tax Returns]

**A teen at SnapApp without an invite:**

> **You need an invite from your parent**
>
> To use SnapApp with a teen account, the parent or guardian who approved your YourTal account needs to invite you from their SnapApp account. Nothing from your account was shared with SnapApp.
>
> [Back to SnapApp]

- Not yet approved: "Your parent or guardian hasn't approved your YourTal account yet. We've emailed them. Once they approve it, they can invite you to SnapApp."
- Invited by someone else: "This invite wasn't made by the parent or guardian who approved your YourTal account. Ask them to send you one."
- Expired or used: "This invite has expired or has already been used. Ask your parent for a new one."

**An Indonesian account at Free Tax Returns:**

> **Free Tax Returns is for Australia**
>
> Your YourTal account is for Indonesia, so you can't use it to sign in to Free Tax Returns. Nothing from your account was shared.
>
> [Back to Free Tax Returns]

**A suspended account:**

> **Your YourTal account is on hold**
>
> You can't use it to sign in to other apps right now. Contact YourTal support.

### 3.5 Linked apps, removing access and deletion

**Me → Linked apps** replaces today's code-only page with the connections list [`12`](12-patterns-from-the-giants.md) recommends:

> **Linked apps**
>
> Apps you sign in to with YourTal.
>
> **SnapApp** · Signed in since {date}. Gets your name, email, age group and country. [Remove]
>
> **Free Tax Returns** · Run by {operator}. Signed in since {date}. Gets your name, email, age group and country. [Remove]

Removing an app, as an adult:

> **Remove SnapApp?**
>
> You'll be signed out of SnapApp, and it can't sign you in with YourTal until you agree again. Your SnapApp account and data stay with SnapApp, and you can delete them there.
>
> [Remove] [Cancel]

As a teen: "Your SnapApp space will be deleted, and you'll need a new invite from your parent to use SnapApp again."

**Deleting a YourTal account** gains one point on the existing list:

> - Apps you sign in to with YourTal, such as SnapApp and Free Tax Returns, are told, and delete what they hold about you within 3 days. They keep only records the law requires. Download anything you need from them first.

**The first time a person agrees to an app**, YourTal emails them:

> **You signed in to {app} with YourTal**
>
> You used your YourTal account to sign in to {app}, run by {operator}. It gets your name, email, age group and country.
>
> Not you? Change your YourTal password, then remove {app} under Me → Linked apps.

---

## 4. Threats and mitigations

| Threat                                        | How it works                                                                                                                                                                                                                                        | Mitigations                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phishing the sign-in or consent screen**    | A look-alike page collects a YourTal password, or gets a person to approve an app they did not mean to                                                                                                                                              | Passkeys, offered after the first password sign-in and required for staff, only work on YourTal's real address. No dynamic client registration, so nobody can register a fake "SnapApp": the names, companies and return addresses on the screen come from YourTal's registry. `frame-ancestors 'none'` stops clickjacking. The first sign-in to each app is emailed to the person (§3.5) |
| **Mix-up**                                    | An app that uses two providers is tricked into sending one provider's code to the other                                                                                                                                                             | The `iss` response parameter, checked by both apps; a callback path per provider; PKCE; the issuer comes from configuration, never from a request                                                                                                                                                                                                                                         |
| **Open redirects**                            | YourTal, or an app's callback, sends the person where an attacker chooses, perhaps with a code                                                                                                                                                      | Exact redirect URI matching; errors before the client is confirmed are shown, never redirected; no logout redirects; "Back to {app}" goes to the registered address. After sign-in, apps send people only to same-origin paths they stored themselves                                                                                                                                     |
| **Token leakage in the phone app**            | Another app on the phone catches the redirect, or a token ends up in logs or storage                                                                                                                                                                | PKCE `S256`: a caught code is useless without the verifier, which never leaves SnapApp's server. A reverse-DNS private-use scheme. The system browser, never a WebView. No YourTal token ever reaches the phone; only SnapApp's own session, in secure storage. No codes or tokens in logs or crash reports                                                                               |
| **Takeover through an app's own email login** | Someone with access to a person's mailbox, or holding a recycled address, uses an app's magic link or email code to get in without meeting YourTal's passkey; or registers the person's email at YourTal first and gets linked to their app account | YourTal finishes no app sign-in for an unverified email. Apps link by email once, only when `email_verified` is true, only to an account never linked before, and key on `sub` forever after. Apps retire their own sign-in methods (§1.10). Account recovery happens only at YourTal, behind its 72-hour value freeze ([`14`](14-security-engineering.md) §5)                            |
| **Forged or replayed events**                 | Someone posts a fake `account-deleted` to erase a person's data in an app                                                                                                                                                                           | Signed by YourTal and checked against its JWKS; `aud`, `iss` and `typ` checked. A replay is harmless, because acting is idempotent. The events endpoint is rate-limited                                                                                                                                                                                                                   |

**Accepted, not solved:** a teen can claim an adult date of birth when registering at YourTal. Age is self-declared, as the teen-mode self-assessment in [`24`](24-legal-positions.md) records, and this design adds no protection beyond it.

---

## 5. What changes in each repo

### YourTal (group 3.9, and its halves of 3.7 and 3.10)

- **Provider (Area A):** `apps/api/src/modules/oidc/` with `oidc-provider` 9.x at `/oidc` and the settings in §1.1; a Postgres adapter; `findAccount` from `identity.user_profile` and `identity.credential`; `pairwiseIdentifier` over `oidc.subject`; the client registry (§1.9); the checks in §1.5; interaction endpoints for the web; the invite API (§3.3); a `renderError` that shows YourTal's error page. The route registry declares `/oidc/*`, and a test proves nothing else is mounted there.
- **Database** (add-only; the sketch below, the real DDL is the database ticket's): the `oidc` schema, `identity.consent_record.audience`, and grants for `yourtal_app`.
- **Consent and deletion:** in `packages/consent`, a `connected_apps` data domain (erase), with its handler in `apps/api/src/shared/dsar/deletion-handlers.ts`; the consent source `guardian_invite`; `sister_app_profile_sharing`'s description becomes "Let an app you sign in to with YourTal see your name, email, age group and country" (it still says "profile and balance" and "YourtalID"); the `identity` domain's stale "YourtalID (Zitadel)". Guardian withdrawal and guardian deletion also end the teen's app consent and write their events.
- **Worker and drivers:** the event delivery job; `became-adult` from the daily 18th-birthday job; a live driver for event delivery, allowed on staging.
- **Web (Area B):** the `/connect/[uid]` sign-in, consent and refusal screens; Me → Linked apps; the delete-account and guardian copy in §3.
- **Passkeys and authenticator codes (3.9.c):** `@simplewebauthn/server` 14.x with `@simplewebauthn/browser`, and `otpauth` 9.x; credential kinds `passkey` and `totp` in `identity.credential`; `amr` in ID tokens.
- **Helios (lead session):** `location ^~ /oidc/` in the nginx vhost; `/opt/yourtal/secrets/oidc/` with the JWKS, the cookie keys and FTR's client secret; the key rotation script; an uptime check on discovery; rate limits and a per-app sign-in log (3.9.h).
- **Docs:** [`14`](14-security-engineering.md) §5's "As an OIDC provider (deferred)" row points here; the founder's answers to §6 go into [`16`](16-decisions.md) § V.

```sql
CREATE SCHEMA oidc;
-- The provider's own records: interactions, codes, grants, client-credential tokens.
CREATE TABLE oidc.model (
  kind text, id text, payload jsonb NOT NULL, grant_id text, uid text,
  expires_at timestamptz, consumed_at timestamptz, PRIMARY KEY (kind, id));
-- One random sub per person per app. Erased on deletion.
CREATE TABLE oidc.subject (
  sector text, user_id text, sub text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sector, user_id), UNIQUE (sector, sub));
-- What a person shares with each app now. The evidence goes to identity.consent_record.
CREATE TABLE oidc.app_consent (
  user_id text, sector text, scopes text[] NOT NULL, policy_version_id text NOT NULL,
  granted_via text NOT NULL CHECK (granted_via IN ('consent_screen', 'guardian_invite')),
  invite_id uuid, granted_at timestamptz NOT NULL, ended_at timestamptz, end_reason text,
  PRIMARY KEY (user_id, sector));
CREATE TABLE oidc.teen_invite (
  id uuid PRIMARY KEY, sector text NOT NULL, code_hash text NOT NULL UNIQUE,
  inviter_user_id text NOT NULL, region text NOT NULL, teen_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  accepted_at timestamptz, ended_at timestamptz, end_reason text);
-- Signed events waiting for an app. Holds the app's sub and nothing else personal.
CREATE TABLE oidc.event_outbox (
  jti uuid PRIMARY KEY, client_id text NOT NULL, sub text NOT NULL, event_type text NOT NULL,
  payload jsonb NOT NULL, iat timestamptz NOT NULL, attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
  failed_at timestamptz, last_error text);
CREATE TABLE oidc.sign_in_log (
  id bigserial PRIMARY KEY, user_id text NOT NULL, client_id text NOT NULL,
  result text NOT NULL, at timestamptz NOT NULL DEFAULT now());
-- The app a sister_app_profile_sharing record is about.
ALTER TABLE identity.consent_record ADD COLUMN audience text;
```

### SnapApp (group 3.3, 3.6, 3.7 and 3.10)

- **Server:** `openid-client` 6.x and `jose` 6.x; `POST /v1/auth/yourtal/start` and `/finish` (§1.9) with a 10-minute flow table; the `private_key_jwt` keys in `/etc/snap-apps/secrets/`.
- **Linking:** a new SECURITY DEFINER function beside `identity_sign_in` that finds the user by `subject`; else links a legacy account (subject starting `dev|` or `pwd|`) with the same verified email; else creates one. It refreshes the email and name copies. A second `sub` for a linked account goes to the review list.
- **Website:** "Sign in with YourTal", the callback route, and `prompt=create` behind "Create account".
- **Phone app:** `expo-web-browser`; the `au.com.snapapps.app` scheme added to `app.json`; no YourTal tokens on the device; SnapApp's own refresh token in SecureStore.
- **Events:** `POST /v1/yourtal/events` with the raw body, as for the Stripe webhook; an inbox table; a new `jobs` kind.
- **Erasure for one person,** also behind a self-service delete in settings: personal workspaces and their files (`storage.ts` gains a delete); memberships; the person's attribution in shared workspaces (the six foreign keys with no `ON DELETE` rule get `SET NULL`, made nullable where needed); mail records; then the user. The person's request overrides `retention_until` in their own personal workspaces; a shared business workspace keeps its records and loses only the person. Ending sessions in 5 minutes needs group task 1.2.c.
- **Staff:** `platform_staff` sign-ins need `amr` with `hwk` or `mfa`.
- **Teens (3.10):** the teen space is a personal workspace marked as a teen space, with the teen as its full member and the inviting parent as a `readonly` member, so the existing RLS does the rest. Its membership is locked: no other invites, and the teen cannot remove the parent. A teen belongs to no other workspace; their receipts are never reported to YourTal; they buy nothing (§6 Q5); they see no house ads. The notices in §3.3, and handling for `access-ended` and `became-adult`.
- **Retire** password, magic-link, Google and email-only demo sign-in (3.3.d), and correct `docs/ECOSYSTEM.md`'s "Nothing stores a password today".

### Free Tax Returns (group 3.5, 3.6 and 3.7)

- **Provider:** Better Auth `genericOAuth` with provider id `yourtal`: `discoveryUrl`, `issuer`, `requireIssuerValidation: true`, `pkce: true` (it defaults to off), `authentication: "basic"`, and scopes `openid email profile account`. A profile whose `age_band` is not `adult` or whose `region` is not `AU` is refused.
- **Linking:** `account.accountLinking.trustedProviders: ["yourtal"]` and `requireLocalEmailVerified: false`, because most FTR accounts never verified their email and YourTal has. A `databaseHooks.account` before-hook strips the YourTal tokens and refuses a second YourTal account for one user (to the review list).
- **ID token:** Better Auth decodes it without checking the signature. That is acceptable only because it comes straight from YourTal's token endpoint over TLS, with client authentication (OIDC Core §3.1.3.7). FTR never accepts a YourTal token from anywhere else without verifying it with `jose`.
- **Sign-in page:** one "Sign in with YourTal" button, started with Better Auth's client (a fetch and a navigation, not a form post, because FTR's CSP has `form-action 'self'`).
- **Accounts come only from a YourTal sign-in:** `capture-account.ts` stops creating users when a questionnaire is submitted; the save-claim modal's SMS code, `/accept-invite`'s SMS code (a staff invite now matches the verified email of the staff member's YourTal sign-in), email-code recovery and the mounted magic-link endpoints all go; Twilio retires (3.5.e).
- **Events:** `POST /api/yourtal/events` (Node runtime, raw text body, `jose`), an inbox table, and processing from the host cron every minute or straight after storing. The erasure is today's `/api/account/delete`, made callable and extended to the rows keyed by email.
- **Staff:** sign-ins need `amr` with `hwk` or `mfa`.
- **Settings:** `YOURTAL_ISSUER`, `YOURTAL_CLIENT_ID`, `YOURTAL_CLIENT_SECRET`. The privacy policy and terms name YourTal as the sign-in provider and say what it shares (group task 6.6.b).
- **Production** switches only when §6 Q1 allows; until then the YourTal button sits behind a switch on `freetaxreturns.com.au`, which has no staging site (F124).

### Earlier decisions this changes

| Earlier                                                                                                                       | Change                                                                                                                                                               | Why                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| YourTal 12.4.b: a teen cannot grant `sister_app_profile_sharing` or link apps                                                 | Still true for anything a teen does alone. The one new path is a guardian's invite into SnapApp (source `guardian_invite`). Linking for receipt points stays refused | F105, F101                                                 |
| The guardian page: data "never shared with a business except as an anonymous total"                                           | Adds the SnapApp exception, only by the guardian's own invite                                                                                                        | F105                                                       |
| [`16`](16-decisions.md) F6 (Technology & organisation, 2026-09-18): "optional linking for existing ones. No forced migration" | Existing SnapApp and FTR users move to YourTal at their next sign-in (group 3.6.e), and the apps' own sign-ins retire                                                | F99 and the group plan; record that it supersedes F6 there |
| [`14`](14-security-engineering.md) §5, "As an OIDC provider (deferred)"                                                       | Now current, and followed. The DPoP-bound earn SDK stays deferred: receipts keep the partner HMAC (group 2.5)                                                        | F99                                                        |
| Group task 3.3.c, "refresh tokens in secure storage"                                                                          | SnapApp's own refresh token; YourTal issues none in phase 3                                                                                                          | §1.6                                                       |
| YourTal task 2.3.b: staging boots only with every driver simulated                                                            | Event delivery may run live on staging, as email does in group 1.3                                                                                                   | §2.4                                                       |
| Red line 11 ([`24`](24-legal-positions.md)): no real personal data on Helios                                                  | Unchanged, and it blocks FTR's production switch                                                                                                                     | §6 Q1                                                      |

---

## 6. Open questions for the founder

**Answered by the founder, 2026-10-20** (docs/16 § V, F108–F114):

- **Q1: A.** Staging now; real users wait for the hosting document and the APP 8 position (F108). FTR is pre-launch with no real users yet.
- **Q2: C.** `yourtal.gaiada.com/oidc` stays the issuer in production (F109).
- **Q3: A.** Australia only (F110, defaulted).
- **Q4: B.** A teen's space is kept 30 days after access ends, then erased (F111).
- **Q5: neither A nor B.** A teen is part of the parent's account: no free scans of their own and no purchases; the teen's scans spend the parent's credits (F112).
- **Q6: A.** An optional, unticked consent line; link codes retire (F113).
- **Q7: A.** Legal entity names, to come (F114).

The questions as they were asked:

**Q1. When may real people sign in with YourTal?** FTR is live, so switching it would put real Australians' accounts into YourTal, which runs on Helios. Red line 11 forbids real personal data on Helios until a document establishes where it is held, and [`24`](24-legal-positions.md) lets only counsel lift a red line.

- **A (recommended):** build and test everything on staging now, with staff and internal testers. FTR's production switch, and SnapApp's first real users, wait until red line 11 is lifted: the hosting document plus the APP 8 position (group 6.2.c).
- B: move YourTal's database to an Australian host before launch, so Australian data never sits on Helios. More work, and it changes the deployment.
- C: lift red line 11 now on today's evidence. Not available without counsel.

**Q2. The production sign-in address,** which goes into every app's settings.

- **A (recommended):** YourTal's production web address plus `/oidc`, settled together with the production domain ([`11`](11-seo-aeo-geo.md) §7 plans `yourtal.com`). Staging keeps `yourtal.gaiada.com/oidc`. Every `sub` carries over, so a later move costs one setting per app.
- B: a separate `id.` subdomain. Its cookies would not be YourTal's, so "Continue as" would lose YourTal's own session.
- C: keep `yourtal.gaiada.com` for production.

**Q3. Which regions may use Free Tax Returns?**

- **A (recommended):** Australia only. FTR is an Australian tax product, Indonesia is a demo (F104), and sharing an Indonesian account with an Australian company is a cross-border disclosure.
- B: Australia and Indonesia.

**Q4. What happens to a teen's SnapApp space when their access ends** (the parent ends it, the guardian withdraws, or the teen removes SnapApp)?

- **A (recommended):** it is erased within 3 days. The parent is warned before ending it, and the teen is told.
- B: it is kept for 30 days, so a new invite can bring it back, then erased.
- C: it is kept until the teen deletes it.

**Q5. Can a teen buy SnapApp credits?**

- **A (recommended):** no. The teen cannot pay; the inviting parent can add credits to the teen's space.
- B: free scans only, with no credits in a teen space.
- C: teens buy credits like adults.

**Q6. Receipt points once SnapApp uses YourTal sign-in** (group 3.9.g asks whether link codes stay).

- **A (recommended):** replace link codes with an optional, unticked line on SnapApp's consent screen ("Earn YourTal points for receipts you scan"), which adults can turn off in Linked apps. SnapApp then reports receipts with the person's `sub`.
- B: keep link codes as a separate step.

**Q7. The company names on the consent screens.**

- **A (recommended):** the legal name of the company that runs each app, so people know who gets their details. This needs the exact names for SnapApp and Free Tax Returns.
- B: the brand names only.
