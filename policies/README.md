# Authorization policies

**YT-0035.** The policy decision point (PDP) for YourTal: every authorization
question the platform can ask, answered in one place, in policy-as-code.

```bash
pnpm policy:test        # compile + run every suite (needs Docker)
pnpm policy:compile     # compile only
```

Cerbos is pinned to **0.55.0** in `scripts/policy-test.mjs`. The pinned version
and the deployed sidecar's version must move together — a policy repo that
compiles under one Cerbos and not another is an incident waiting for an
upgrade.

---

## The one idea

**Deny by default, and never ask twice.**

A service never decides whether a caller may do something. It assembles a
principal and a resource, asks the PDP, and obeys. That is worth the ceremony
for one reason: authorization bugs are not evenly distributed. They cluster at
the edges nobody thought about — the seventh role, the second tenant, the
action added in a hurry. A rule written once and tested here covers all of
them; a check written per endpoint covers the endpoints someone remembered.

## Layout

| Path                          | What lives there                             |
| ----------------------------- | -------------------------------------------- |
| `_schemas/principal.json`     | Every attribute the PDP may reason about     |
| `_schemas/resource/*.json`    | Per-kind resource attributes                 |
| `derived_roles/business.yaml` | Tenant-scoped business roles + store devices |
| `derived_roles/common.yaml`   | Consumer ownership                           |
| `resource_policies/*.yaml`    | One file per resource kind, 14 of them       |
| `tests/*_test.yaml`           | 12 suites, 322 assertions                    |
| `tests/testdata/`             | Shared principal and resource fixtures       |

Both schema files use `additionalProperties: false`. That is deliberate: an
attribute name the policy repo does not recognise is a typo or a half-finished
feature, and either should fail loudly in CI rather than quietly produce a
DENY that reads like a policy bug. Silent-deny-on-typo is the classic way to
lose an afternoon to this tool.

## The role model

Flat roles come from the identity provider (email and password auth behind an IdentityProvider seam, per docs/16 N-3; Zitadel YT-0032 is deferred):

`anonymous` · `user` · `business_user` · `store_device` · `charity_admin` ·
`support` · `moderator` · `risk_analyst` · `finance` · `ops` · `admin`

**There is no `business_admin`.** A flat role cannot answer _admin of which
business_, so every business person carries `business_user`, and the role they
hold at a particular business is looked up per request from
`P.attr.businessRoles` — a `businessId -> role` map. `derived_roles/business.yaml`
does that lookup once, in one variable, and every rule reads the result.

Two things fall out of this that are worth stating plainly:

- **Cross-tenant access needs no rule.** A principal with no entry for the
  resource's `businessId` matches no derived role, and Cerbos is deny-by-default.
  docs/14 §3 ("Cerbos denies cross-tenant grants outright") is satisfied
  structurally, not by a rule someone could forget to write.
- **One person can hold different roles at different businesses**, which is
  ordinary in this market and which a flat role list simply cannot express.
  `hasan_two_hats` in the fixtures is owner of one business and analyst at
  another; `campaign_test.yaml` asserts both answers.

Store staff are **not** in that map. They are device sessions bound to a
business and a location (docs/17 §2.2), carried as the `store_device` role and
derived as `store_device_of`.

## What is enforced here rather than in a service

These are product invariants, not access control in the usual sense. They live
here because a rule in the PDP is tested once and cannot be hot-fixed around at
3am:

| Invariant                                                                | Where                                         | Source                   |
| ------------------------------------------------------------------------ | --------------------------------------------- | ------------------------ |
| No business role can ever grant points                                   | `ledger_adjustment.yaml`                      | docs/17 §2.1, docs/14 §3 |
| Exactly one owner; transfer needs fresh step-up re-auth                  | `team.yaml`                                   | docs/17 §2.1             |
| Two-person approval: bulk issuance, settlement cuts, credential rotation | `voucher_batch`, `listing`, `redemption`      | docs/17 §2.1             |
| A counter device may redeem, look up, and see today — nothing else       | `redemption.yaml`, `report.yaml`              | docs/17 §2.2             |
| Whoever can suspend cannot adjust; nobody approves their own adjustment  | `user_account.yaml`, `ledger_adjustment.yaml` | docs/17 §5               |
| Support cannot change a phone number, by any route                       | `user_account.yaml`                           | docs/14 §5               |
| Anonymous viewers may watch and may never earn                           | `campaign_view.yaml`                          | docs/17 §4.1             |
| An open view against an unfunded budget is refused                       | `campaign_view.yaml`                          | docs/10, docs/17 §4.2    |
| Unmoderated or PII-bearing creative cannot be published                  | `campaign.yaml`                               | YT-0103, YT-0113         |
| `admin` has no direct data access                                        | structural — see below                        | docs/17 §5               |

The last one is enforced by absence: `admin` appears in exactly one resource
policy (`platform_setting.yaml`) and deny-by-default does the rest. Two tests
guard it — `tests/admin_boundary_test.yaml` from the PDP's side, and
`packages/authz/src/policy-drift.test.ts` from the repo's side, which fails if
`admin` is ever added to another policy. That is how a break-glass role quietly
becomes a god role, so it gets a tripwire.

### On DENY rules that look redundant

Several rules deny something that no ALLOW grants anyway. That is intentional.
In Cerbos a DENY always wins, so an explicit DENY survives a future rule that
widens some role for convenience. The four extra lines cost nothing; being
wrong about `ledger_adjustment` costs money.

## Adding a resource kind

1. `_schemas/resource/<kind>.json` — the attributes, strict.
2. `resource_policies/<kind>.yaml` — the rules, deny-by-default.
3. `tests/<kind>_test.yaml` — assert the allows **and** the denies. A suite
   that only tests allows is how a policy passes while granting the world.
4. Add the kind and its actions to `packages/authz/src/resources.ts`.

Step 4 is not optional: `policy-drift.test.ts` compares the two sides in both
directions and fails the build if they disagree. An action in TypeScript with
no rule is permanently DENY (a silently broken endpoint); an action in a policy
with no TypeScript entry is a rule no caller can reach (false coverage).

## Calling the PDP

`packages/authz` is the only sanctioned client — see its
[`pdp-client.ts`](../packages/authz/src/pdp-client.ts). It returns a
`Result`, never a boolean, because docs/14 §8 (A10) requires value operations
to **fail closed**: a Cerbos timeout must never fall through to "grant". An
unreachable PDP is `pdp_unavailable`, which is neither an allow nor a deny, so
a caller cannot write `if (await allowed(...))` and silently treat an outage as
permission.

Cerbos runs as a **stateless sidecar** on loopback (docs/10, docs/15), not as a
shared cluster service. An authorization check on the request path cannot
afford a network hop, and a shared PDP would be a single point of failure for
every deny in the system.

## What is not done yet

**Route-level enforcement is YT-0500.** The third acceptance criterion of
YT-0035 — "every API route resolves authz through the PDP, never ad hoc" —
cannot be satisfied while there is no `apps/api` to have routes (that arrives
with YT-0100). What exists today is the policy repo, the role model, the
typed client, and the drift test that makes it impossible to name an action
the PDP has no answer for. The NestJS guard, and the CI check that fails a
route carrying no authz decorator, land with YT-0500.

**The `neverthrow/must-use-result` lint rule is not wired up.** docs/13b §4
calls for it, and it is what would turn an _unhandled_ authorization Result
into a build failure rather than a silently discarded check — the last gap
between "fails closed by construction" and "fails closed if the caller reads
the type". It is not enabled here because `eslint-plugin-neverthrow` is a
legacy-format plugin last published in 2022, enabling it edits the shared
`eslint.config.mjs` that other in-flight work depends on, and docs/14 §7 puts
a human gate on new dependencies. Worth doing deliberately in YT-0500, not as
a side effect of this ticket.
