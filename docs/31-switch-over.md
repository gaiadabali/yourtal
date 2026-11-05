# 31. Switch over to "Sign in with YourTal" (group task 3.8.a)

Status: plan, 2026-11-05. Nothing here has been run. Anything marked **to confirm** was not checked against the live server (Helios was not touched).

Scope: turn on "Sign in with YourTal" for SnapApp and Free Tax Returns (FTR) in production. Sources: docs/26 (design), docs/29 (deletion), docs/30 (direct send), SnapApp `docs/AUTH.md`, FTR `PRE-LIVE-SETTINGS.md` §1a.

## 1. What "the switch" is

YourTal is the sign-in provider. SnapApp and FTR are its clients. Each app has an off-by-default setting. Until it is set, the app behaves as before.

- SnapApp is on for a client once `YOURTAL_OIDC_ISSUER` and that client's id are set.
- FTR is on only when `YOURTAL_SIGN_IN_ENABLED=1` and its three YourTal settings are set.
- Switching on does not move anyone by force. Existing users move at their next sign-in (3.6.e). Unlinked accounts keep the old sign-in until 3.3.d and 3.5.e retire it (section 6).

## 2. Preconditions (gates)

No step in section 3 starts until the gates marked **hard** are closed. State on 2026-11-05, from TASKS.md.

| Gate                                     | What                                                                                                                                                                                                                    | State                                                                                                | Kind                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Red line 11 / F108, **6.2.c**, **6.7.b** | YourTal runs on Helios; docs/26 §6 Q1 says real users wait for the hosting document and the APP 8 position. Helios was measured in Jakarta (2026-11-03).                                                                | open                                                                                                 | hard, founder + counsel                                                               |
| **6.2**                                  | YourTal legal review (privacy, consent wording)                                                                                                                                                                         | open, 0/5                                                                                            | hard for production (legal never blocks dev, but this is production)                  |
| **BCG**                                  | Free Tax Returns is run by Benjamin Charles Group. They must agree to the switch and the privacy-policy line.                                                                                                           | to confirm                                                                                           | hard for FTR                                                                          |
| **3.8.b**                                | Phase 3 "Done when" passed on staging, then on production                                                                                                                                                               | staging leg partly done (SnapApp 3.7.b legs PASS, FTR leg F 8/8 on 2026-11-05); the full run is open | hard                                                                                  |
| **3.9.h**                                | Uptime check on discovery, one restore test, IPv6 /64 and a site-wide rate ceiling                                                                                                                                      | partly (nginx limit and sign-in log live on staging)                                                 | hard: every sign-in now depends on YourTal                                            |
| Production issuer (docs/26 §6 Q2)        | Founder chose C: `https://yourtal.gaiada.com/oidc` stays the issuer in production (F109)                                                                                                                                | decided                                                                                              | done                                                                                  |
| Production clients                       | docs/26 §3 says SnapApp and FTR production clients follow `snapapp-staging-*`. FTR's `ftr-web` already exists. A SnapApp production web, mobile and server client, a sector `snapapp`, and rows in `event-receivers.ts` | to confirm (not seen in `clients.ts` on main)                                                        | hard                                                                                  |
| **6.9**                                  | App email reaches the inbox (it lands in Spam today). Sign-up verification and the "you were linked" notices are email.                                                                                                 | open                                                                                                 | hard                                                                                  |
| **6.11**                                 | Passkey requirement                                                                                                                                                                                                     | off at launch (decided 2026-11-04)                                                                   | done                                                                                  |
| **3.10.i**                               | Teen invites stay off for real teens until the event sender, L2 and the 30-day hold are live                                                                                                                            | open                                                                                                 | hard for teens only; teens stay refused until then                                    |
| **3.3.e**                                | App Link flip for the phone app                                                                                                                                                                                         | code merged (snap-apps#49), flip not done                                                            | optional: the private scheme keeps working. Do it before real users, not as a blocker |
| **8.1**                                  | Private Android signing key (App Link proof uses the public debug key until then)                                                                                                                                       | open                                                                                                 | soft; see 3.3.e risk                                                                  |
| **6.9 / 6.5.i-k**                        | FTR tax figures for a tax agent                                                                                                                                                                                         | open                                                                                                 | not a sign-in gate; do not mix into this switch                                       |
| Deletion path live                       | YourTal L1 (sender), L2 (SnapApp server client id), L3 (FTR 0017-0021) done on staging 2026-11-04. Production needs the same, with production client ids                                                                | to confirm for production                                                                            | hard: "delete everywhere" is part of Done when                                        |

Who closes the hard gates: the founder (6.2, 6.7, F108, BCG, 6.9), the lead session (Helios work, with the user's OK for each write).

## 3. Order of switches

Rule: one app at a time, SnapApp first (it has the fewer legacy users and no tax data), FTR second. Each step is one change that can be undone alone. Take a backup first for any database step. Every Helios write needs the user's OK.

### Step 0. Freeze and prepare (no user effect)

1. Confirm gates in section 2.
2. Back up YourTal's and each app's database. **To confirm** the current restore test result (3.9.h).
3. Tell the support inbox owners the date and time (section 7, staff note).
4. Pick a quiet window. FTR: outside tax-time peaks. **To confirm** the date with BCG.

### Step 1. YourTal provider on, production clients registered

Where: YourTal on Helios (api and worker env).

| Setting             | Value                                         |
| ------------------- | --------------------------------------------- |
| `OIDC_ENABLED`      | `true` (already on staging)                   |
| `OIDC_ISSUER`       | `https://yourtal.gaiada.com/oidc`             |
| `OIDC_JWKS_PATH`    | default `/opt/yourtal/secrets/oidc/jwks.json` |
| `APP_EVENTS_DRIVER` | `live` (worker; done on staging 2026-11-04)   |

Also: register the production SnapApp clients and the `event-receivers.ts` rows (docs/29 §11 L4 note). **To confirm** the production client ids; staging ids are `snapapp-staging-web`, `snapapp-staging-mobile`, `snapapp-staging-server`. FTR's is `ftr-web`.

Check (3.8.b): discovery document loads; JWKS loads; a test sign-in on a staff account reaches the consent screen.

Roll back: set `OIDC_ENABLED=false`, restart the api. No app is on yet, so no one is affected.

### Step 2. SnapApp website

Where: Helios, `/etc/snap-apps/secrets/yourtal.env` and the deploy `.env` (compose). Recreate the api and the worker after.

| Setting                                | Value                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `YOURTAL_OIDC_ISSUER`                  | `https://yourtal.gaiada.com/oidc`                                                                                    |
| `YOURTAL_OIDC_WEB_CLIENT_ID`           | production web client id (to confirm)                                                                                |
| `YOURTAL_OIDC_WEB_REDIRECT_URI`        | exactly what YourTal registered, https only (default `${WEB_PUBLIC_URL}/auth/yourtal/callback`)                      |
| `YOURTAL_OIDC_KEY_FILE_HOST`           | `/etc/snap-apps/secrets/yourtal-oidc-web.jwk` (chmod 600, chown 1001); its public JWK is registered in YourTal first |
| `YOURTAL_OIDC_SERVER_CLIENT_ID`        | production server client id (needed for deletion events and teen-invite end jobs) (to confirm)                       |
| `YOURTAL_OIDC_KEY_FILE` for the worker | the worker key mount for `teen_invite_end` is a code PR (TASKS 3.7.m): to confirm it is merged                       |

Check (3.8.b): `GET /v1/auth/yourtal` reports `web`. Staff account signs in with a passkey or MFA (it must, or SnapApp refuses `staff_strong_auth_required`). A brand-new person creates a YourTal account from SnapApp and lands in onboarding. An existing user signs in and keeps their workspaces, points and credits (same `users.id`). Old password and magic-link for a linked account answer the ordinary refusal.

Roll back: remove the web client id and write nothing else, then recreate the api. SnapApp shows the old sign-in again. **Caveat:** an account already linked has lost its password, sessions and mailed links in the link transaction (AUTH.md). Switching off does not restore them. Those people use "Forgot password", which is refused for a linked account. So rollback after real people link needs a manual unlink step or a short window. Rule: keep the first live window small (staff and invited testers) before opening to everyone. **To confirm** whether an unlink script exists; if not, write one before Step 2.

### Step 3. SnapApp phone app

Where: same files. Needs the client id for mobile.

| Setting                            | Value                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `YOURTAL_OIDC_MOBILE_CLIENT_ID`    | production mobile client id (to confirm)                                            |
| `YOURTAL_OIDC_MOBILE_REDIRECT_URI` | first `au.com.snapapps.app:/oauth/yourtal` (default). Later the App Link, see below |

Check: `GET /v1/auth/yourtal` reports `mobile`. On a real Android phone: sign in, sign out, create account. The founder's real-phone check (APK 0.1.245) is still owed on another gate (1.29.e), so use the same phone.

**App Link flip (3.3.e), after Step 3 is stable.** Order from AUTH.md, do not reorder: (a) YourTal registers both redirect URIs for the mobile client; (b) nginx serves `/.well-known/assetlinks.json` with no redirect; (c) publish the new APK; (d) set `YOURTAL_OIDC_MOBILE_REDIRECT_URI` to `https://snap-apps.gaiada.com/oauth/yourtal` only after a real-device check on staging with that env: fresh sign-in AND silent return with a live YourTal session, and `adb shell pm get-app-links au.com.snapapps.app` says `verified`; (e) later remove the old URI in YourTal; (f) next build drops the scheme. A production domain needs its own intent filter host and assetlinks and a rebuild. Roll back (d): put the old URI back in the env. YourTal keeps both until (e), so old and new builds both work.

### Step 4. FTR

Where: Helios, `/home/ufreetax/.env`, run as user `ufreetax` under pm2 (`ecosystem.config.cjs`, port 4010).

Do first, in this order (PRE-LIVE-SETTINGS §1a): migrations `0017` to `0021` on `ftr_prod` (applied 2026-11-04 with backups in `/root/ftr-backups/`; **to confirm** none are pending), YourTal client `ftr-web` registered with the exact redirect `https://freetaxreturns.com.au/api/auth/oauth2/callback/yourtal`, AU only, teens refused.

| Setting                                                  | Value                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `YOURTAL_ISSUER`                                         | `https://yourtal.gaiada.com/oidc` (https only)                                               |
| `YOURTAL_CLIENT_ID`                                      | `ftr-web`                                                                                    |
| `YOURTAL_CLIENT_SECRET`                                  | the secret from YourTal's `ftr-web.secret`; letters and digits only; never paste it anywhere |
| `YOURTAL_SIGN_IN_ENABLED`                                | `1` (exact value)                                                                            |
| `DEDUCTION_IMPORT_ENABLED`, `DEDUCTION_TRANSFER_ENABLED` | stay `0`. They are separate (4.6, 4.8) and need BCG. Not part of this switch                 |

Apply: edit `.env`, then re-parse pm2 as in PRE-LIVE-SETTINGS §5 "Changing .env" (`pm2 delete` then `pm2 start ecosystem.config.cjs`, then `pm2 save`). A plain `pm2 reload ... --update-env` does **not** re-read `.env`. The poller deploy only reloads, so code deploys do not change the switch.

Check: `https://freetaxreturns.com.au/login` shows "Sign in with YourTal". `pm2 jlist` shows `YOURTAL_SIGN_IN_ENABLED` is `1`. A staff user with a passkey signs in to `/admin`. A phone-only test user sees the "Connect your YourTal account" prompt on `/account`. `GET /api/health` stays 200.

## 4. Roll back, step by step

| Step            | How to undo                                                                                        | Check it is really off                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 4 FTR           | **Write `YOURTAL_SIGN_IN_ENABLED=0`. Do not delete the line.** Re-parse pm2.                       | `/login` has no "Sign in with YourTal"; `pm2 jlist` shows `pm2_env.YOURTAL_SIGN_IN_ENABLED` is `0` |
| 3 SnapApp phone | Remove `YOURTAL_OIDC_MOBILE_CLIENT_ID`, recreate api. App Link: restore the old redirect URI value | `GET /v1/auth/yourtal` no longer lists `mobile`                                                    |
| 2 SnapApp web   | Remove `YOURTAL_OIDC_WEB_CLIENT_ID` (or the issuer), recreate api                                  | `GET /v1/auth/yourtal` no longer lists `web`                                                       |
| 1 YourTal       | `OIDC_ENABLED=false`, restart                                                                      | discovery returns 404                                                                              |

### The pm2 `=0` trap (FTR)

On 2026-11-05 a line `YOURTAL_SIGN_IN_ENABLED=1` was removed from `/home/ufreetax/.env` and pm2 was reloaded with `--update-env`. The switch **stayed on**: pm2 keeps the old value in its stored env. So:

1. Write `KEY=0`, never delete the line.
2. Reload as above.
3. Prove it from outside (the login page, and for direct send `POST /api/yourtal/transfers` returns 404) and with `pm2 jlist`.

The line in PRE-LIVE-SETTINGS §1a ("unset the switch and re-parse") is wrong for this reason. Fixing it is TASKS 4.10.d. Do it before the FTR step.

### What rollback cannot undo

- Accounts already linked keep their link. A linked account is refused by the old sign-ins in SnapApp and FTR even if the YourTal button is hidden. FTR says "People already linked can then sign in with their phone or an email code again", while the code says a linked account is refused by those methods when the switch is on; with the switch off the rules are removed. **To confirm** on staging with a linked test user before launch.
- Deleted accounts stay deleted. Deletion events from YourTal still run with the sign-in switch off (FTR needs only `YOURTAL_ISSUER` and `YOURTAL_CLIENT_ID`).
- Rule: if sign-in breaks, switch the app's button off, keep the deletion receiver on, tell users (section 7), fix, retry.

### Fallback when YourTal itself is down

Every sign-in depends on YourTal. People already signed in to an app keep their app session (SnapApp 30 days absolute, 14 days idle; FTR own session). New sign-ins fail. Do not reopen old passwords for linked accounts. The fallback is: show the status message (section 7), restore YourTal from backup (3.9.h restore test), and keep staff on a break-glass route. **To confirm** whether any break-glass staff route exists; none is documented. Do not build one without a decision.

## 5. What happens to existing people

| Who                                                     | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SnapApp user with a verified email                      | At their next sign-in they press "Sign in with YourTal" (creating a YourTal account if they have none). If the YourTal email matches their verified SnapApp email, SnapApp attaches the YourTal sub to their existing user: same `users.id`, same points and credits, same workspaces (0039). Password is removed, other sessions end, old mail links stop.                                                                                                                            |
| SnapApp user whose YourTal email differs                | The prompt moves them to a new empty account (3.6.e follow-up). The decision of 2026-11-04 was to **build the warning before the FTR switch**. **To confirm** it is merged and covered by the Step 2 check.                                                                                                                                                                                                                                                                            |
| SnapApp conflicts (second YourTal account, email taken) | A row goes to the review list; the person sees "account review" (3.6.c, snap #60). Someone must read that list during the first weeks. **To confirm** who.                                                                                                                                                                                                                                                                                                                             |
| FTR user with a verified email                          | Linked once by the verified email, only if never linked before and no verified phone. After linking, FTR keys on the sub.                                                                                                                                                                                                                                                                                                                                                              |
| FTR phone-only or verified-phone (Twilio) user          | Not linked by phone, ever. They sign in with their phone as today, then press "Connect YourTal" in account settings or on the prompt on `/account` (within 5 minutes of the phone sign-in; other sessions end; the owner is emailed). With no SMS (0.7.b), phone-only accounts end: they must add and verify an email. Twilio Verify and the legacy sender retire only after every user has moved (3.5.e). **To confirm** the cut-off date and what happens to users who never return. |
| Teens (under 18)                                        | FTR refuses them with its own message. Every client except SnapApp refuses them. SnapApp accepts a teen only through a parent's invite (3.10), and until 3.10.i is live a teen gets "teen invite required". Not a bug; say so in support.                                                                                                                                                                                                                                              |
| Indonesian accounts (region ID)                         | FTR refuses them (AU adults only). SnapApp allows AU and ID.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Staff and owners                                        | Need a passkey or authenticator app (amr `hwk` or `mfa`) and a sign-in in the last 12 hours. Roles stay in each app. Tell them before the day.                                                                                                                                                                                                                                                                                                                                         |
| People who delete their YourTal account                 | Deleted from each app within 72 hours (docs/29). Not a switch-over matter, but the message says so.                                                                                                                                                                                                                                                                                                                                                                                    |

## 6. After the switch (not part of go)

- 3.3.d: retire SnapApp's password and magic-link sign-in once users have moved. Known residual: if legacy sign-up is still open when teen invites turn on, add the no-link flag to 0039's function.
- 3.5.e: retire Twilio Verify once every FTR user has moved.
- 3.8.b closes only after the production pass. 3.6 closes with it.
- Watch for a week: sign-in log per client (3.9.h), review lists, support inbox, `/api/health`, uptime on YourTal discovery.

## 7. Messages (en-AU, short)

Plain text. Use the same words in the app banner and the email. Reviewed by BCG for FTR (**to confirm**). Do not name any vendor. Do not mention the data location until 6.7 decides the wording.

### SnapApp, in-app banner (before the day)

> Heads up: Snap Apps is moving to YourTal for sign-in. Next time you sign in, choose "Sign in with YourTal". Use the same email you use here and your receipts, points and credits stay exactly as they are.

### SnapApp, email (the day before)

Subject: How you sign in to Snap Apps is changing

> Hi,
>
> From [date], you sign in to Snap Apps with YourTal. YourTal is our sign-in service, the same idea as "Sign in with Google".
>
> What to do: open Snap Apps and choose "Sign in with YourTal". If you don't have a YourTal account yet, you can create one in a minute. Use the same email you use now.
>
> What stays the same: your workspaces, receipts, points and credits.
> What changes: your old Snap Apps password and email sign-in links stop working. You sign in with your YourTal password or passkey instead.
>
> You need to be 18 or older to have a YourTal account. If you are under 18, a parent or guardian can invite you to Snap Apps from their own account.
>
> Questions? Reply to this email.

(Sender address and reply path: **to confirm**; support emails were left bouncing by a founder ruling, so name a working one.)

### FTR, in-app prompt (after the switch, on `/account`)

> Connect your YourTal account. From now on, YourTal is how you sign in to Free Tax Returns. Connecting takes a minute and keeps all your returns.

Buttons: "Connect YourTal" and "Not now".

### FTR, email (the day before)

Subject: Signing in to Free Tax Returns is changing

> Hi [first name],
>
> From [date], you sign in to Free Tax Returns with YourTal. We are moving away from text-message codes.
>
> What to do: sign in as usual, then choose "Connect YourTal" and use the same email you use with us. We will not change or delete any of your returns.
>
> If you only have a mobile number on file, add and confirm an email address in Account settings first.
>
> Free Tax Returns is for adults in Australia. You need to be 18 or older.
>
> Questions? Email [FTR support address, to confirm].

### Error and status text (support lines)

- Teen: "Free Tax Returns is for people 18 and over."
- Wrong region: "Free Tax Returns is for people in Australia."
- YourTal down: "Sign-in is having a problem. You are still signed in if you were already. We are fixing it."
- Rollback notice (on the day, if used): "We have paused the move to YourTal while we fix a problem. Sign in as you did before. Nothing was lost."

Note: the last line is true only for people who had not linked yet. For a linked person, write instead: "Please try again soon. Your account and returns are safe."

### Staff note (internal)

> On [date] sign-in moves to YourTal. Staff need a passkey or authenticator app on their YourTal account first. Roles do not change. If someone says they cannot get in: teens are refused on purpose; phone-only users add an email and connect YourTal; conflicts go to the review list.

## 8. Who decides go

- **Go for production:** the founder, in writing, after the hard gates in section 2 are closed. Who "the founder" is now is itself still an open question in STATUS.md: **to confirm**.
- **FTR specifically:** the founder and BCG together (BCG runs FTR and owns its privacy policy and customers).
- **Each Helios write:** the user's OK at the time, as always. The lead session runs the steps, not subagents.
- **Rollback:** the lead may switch an app off on their own call if sign-in fails for real users; the founder is told the same hour.
- **No go** if any hard gate is open, if the 3.8.b production check has a failure, or if a restore test has not passed.

## 9. To confirm (list)

1. Production client ids for SnapApp web, mobile and server, and their YourTal registration and `event-receivers.ts` rows.
2. Who the founder is for the go decision; BCG's written agreement for FTR and their date window.
3. That the 3.6.e email-mismatch warning is merged.
4. An unlink or recovery step for people who link and then need a rollback.
5. Whether FTR linked users can use phone or email codes with the switch off.
6. A break-glass route for staff when YourTal is down (none documented).
7. Who reads the SnapApp and FTR review lists.
8. Whether SnapApp's worker key mount for `teen_invite_end` is merged.
9. Cut-off date for Twilio and what happens to FTR users who never move.
10. Support addresses for the messages; the date and time window.
11. That no FTR migration is pending on `ftr_prod`.
