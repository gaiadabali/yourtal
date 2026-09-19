# YourTal — The Points Economy & Merchant Redemption

**Date:** 2026-09-18
**Why this doc exists:** the reward is **always points**. All business inventory — vouchers, merchandise — is pooled into one store priced in points, at an exchange rate that varies by business. Then a redeemed voucher must be spendable on the *business's own website*, by whoever holds it.

That makes YourTal the **central bank of a two-sided token economy** and the **settlement network** for redemption — the most complex and highest-risk subsystem in the platform, and where the business lives or dies. The disciplines are borrowed, not novel: **game-economy design** (faucets, sinks, inflation), **airline/hotel revenue management** (dynamic award pricing), and **card-network settlement** (authorize / capture / void / refund).

The watch flow gains from this: exactly **one** reward type, no branching. All the variety lives in the store, behind one clean boundary. What it costs is that points become a real currency with a price level, an issuance policy and a solvency requirement — and a voucher becomes a bearer instrument redeemable at a third party's checkout.

---

## 2. A business has up to three separate relationships

These were tangled in earlier drafts. They are independent, and a business may have any subset:

| Role | What they do | Money direction |
|---|---|---|
| **Advertiser** | Uploads video, authors questions, **pre-purchases points** to reward viewers | Business → YourTal |
| **Supplier** | Lists vouchers/merchandise in the store at a declared **settlement value** | YourTal → Business (on redemption) |
| **Redeemer** | Honours a voucher at their own checkout via the redemption API | (settlement, as above) |

**A business that does both #1 and #2 can be settled net.** They pay for points issued; they get paid for redemptions honoured. If those roughly balance, almost no cash moves.

> **This is the sales pitch:** *"Run your campaign for free — fund it with your own inventory."* A merchant with 70% margins is trading IDR 15,000 of real cost for a campaign that would otherwise cost them cash. It is the single easiest thing to sell in the whole platform.

## 3. The structural arbitrage — why this economy works at all

This is the engine, and it should be understood before any parameter is chosen.

```
  Merchant gives up            User perceives            Merchant actually pays
  IDR 50,000 of retail   →    IDR 50,000 of value   ←    IDR 15,000 of COGS
       (a real voucher)                                    (70% margin)

  YourTal sits in the middle and keeps the difference between
  what it collected for the points and what it pays to settle.
```

The user gets IDR 50,000 of genuine value. The merchant gives up IDR 15,000. **Nobody is being deceived** — the merchant really does honour IDR 50,000 — and yet the economy creates about IDR 35,000 of perceived value per voucher out of margin structure alone. That gap is what lets a 20-minute view feel richly rewarded while costing the funding business a fraction of a Meta CAC.

**Everything below exists to keep that gap from being arbitraged away, inflated away, or stolen.**

## 4. The two-price problem — and why businesses cannot set point prices

Suppose businesses freely set how many points their voucher costs.

- Business A funds a campaign: buys 1,000,000 points at **IDR 8/point** → pays IDR 8,000,000.
- Business B lists a IDR 50,000 voucher and prices it at **1,000 points** because they want traffic.
- A user redeems. YourTal collected 1,000 × IDR 8 = **IDR 8,000**, and must now settle with B for the value honoured — say **IDR 15,000** of COGS.

**YourTal loses IDR 7,000 on every redemption, and B has every incentive to keep doing it.** Any business can drain the platform by underpricing. This is not a hypothetical; it is the default outcome of letting suppliers set point prices.

### 4.1 The fix: the business controls the *subsidy*, YourTal controls the *price*

```
  Business declares:   S = settlement value  (what we pay them when redeemed, in currency)
  YourTal computes:    points_price = (S / B) × demand_multiplier
                       where B = backing rate (currency of value delivered per point)
```

`B` is a **platform-set monetary parameter**, never published to users, always **less than** the average issuance price `P_issue`. The spread is the margin.

**Worked example** (`P_issue` = IDR 8/point, `B` = IDR 6/point):

| | Business A (aggressive) | Business B (conservative) |
|---|---|---|
| Voucher face value | IDR 50,000 | IDR 50,000 |
| Declared settlement value `S` | IDR 12,000 | IDR 30,000 |
| **Points price** = S / B | **2,000 points** | **5,000 points** |
| Cash YourTal collected (2,000 × 8 / 5,000 × 8) | IDR 16,000 | IDR 40,000 |
| Cash YourTal settles to supplier | IDR 12,000 | IDR 30,000 |
| **YourTal margin** | **IDR 4,000 (25%)** | **IDR 10,000 (25%)** |
| User's perceived value per point | IDR 25 | IDR 10 |

**The variable exchange rate you described emerges exactly as intended** — A's voucher is a far better deal than B's, and users will notice and flock to A, which is precisely what A wanted when they subsidised it. But the **margin is structurally constant**, and no supplier can price the platform into a loss.

Suppliers get a clear, honest lever: *"lower your settlement value, get a better point price, get more redemptions and more footfall."* That is a dial they understand, because it is just a discount.

### 4.2 The demand multiplier (dynamic pricing)

`demand_multiplier` adjusts price for scarcity and demand — the same mechanism airlines and hotels use for award pricing. A hotel group's deployed pricing engine reported a **22% increase in member value, a 35% reduction in the spread of per-point value, and 20% more members redeeming**, at unchanged reimbursement cost. That is the outcome to aim for: *more consistent* value, not merely cheaper.

**Bounds and rules, non-negotiable:**
- Multiplier bounded (e.g. **0.8–1.25**) so prices never move shockingly.
- **Price shown before add-to-cart, and locked for 10–15 minutes in cart.** Never change a price between the user deciding and the user confirming. This is the fastest way to destroy trust in a points economy.
- Price changes are **logged and auditable** per SKU.
- No per-user price discrimination on identical items. It is legally fraught in both jurisdictions and will be discovered and screenshotted.

## 5. The solvency invariant — the single most important rule in the platform

```
        Reserve
  ─────────────────────  =  coverage ratio  ≥  1.0      (alert below 1.2)
   Points outstanding × B
```

```
Reserve = Σ (points sold to businesses × P_issue)
        + Σ (platform-funded point grants, as REAL cash into the reserve)
        − Σ (settlements already paid to suppliers)
        − Σ (operating draws, which should be zero from this account)
```

**The trap: unfunded faucets.** Points awarded for sister-app actions, referrals, streaks, promos and goodwill credits have **no business paying for them**. If those are simply minted, YourTal is printing money against a liability it cannot cover — and the failure mode is silent until the store empties or margins go negative.

**Rule: every point issued without a business paying for it must be funded by a real cash transfer from the platform's marketing budget into the reserve, at the moment of issuance.** No exceptions, no "we'll true it up later." This is a two-line ledger entry and it is the difference between a solvent economy and a slow-motion insolvency.

Monitor daily. Coverage dropping is the earliest possible warning that something is wrong.

## 6. Monetary policy — faucets, sinks and the control levers

Game economies state the rule plainly: **every faucet needs a sink.** If issuance outpaces removal, the price level rises, prices must be raised, and users experience it as the platform cheating them.

| Faucets (points in) | Sinks (points out) |
|---|---|
| Campaign completion + accuracy bonus | **Redemption** (the primary sink) |
| Sister-app actions (receipt scans etc.) | **Expiry / breakage** |
| Streaks, quests, daily check-in | Marketplace take rate on transfers/sales |
| Referrals | Transfer fee (also a fraud brake) |
| Promotional grants | Premium/scarce items priced high |
| | Tier upgrades, skips, cosmetic unlocks |

Game-economy practice also notes that **sinks must scale with the heaviest earners** — the users generating the most currency are the ones who need somewhere to spend it, or they become the source of the imbalance.

**Control levers, in order of how gentle they are:**

| # | Lever | Effect | User-visible pain |
|---|---|---|---|
| 1 | **Add inventory** | Solves the actual problem — more things to buy | None. Always try this first |
| 2 | Adjust `demand_multiplier` on specific SKUs | Targeted | Low |
| 3 | Adjust `B` (backing rate) | Repricing across the whole catalogue | **High — this is a devaluation.** Announce it, never do it silently |
| 4 | Reduce faucet rates (points per completed view) | Slows issuance | Medium; feels like a pay cut |
| 5 | Tighten expiry | Increases breakage | Medium; check consumer-law limits |
| 6 | Emergency daily earn caps | Hard stop | High. Reserve for incidents |

**Dashboard the economy team looks at every morning:** issuance rate vs. redemption rate, points outstanding and its growth, coverage ratio, average realised value per point (the "cost of your points" — the average redemption cost across the catalogue), days-to-first-redemption, catalogue depth by price band, and the share of outstanding points held by the top 1% of holders.

**This needs a named owner** — an analyst or economist, not only engineers. An economy without a person watching it drifts, and by the time engineering notices, it has drifted for a quarter.

## 7. Voucher lifecycle and transfer

The scenario: **User A and User B each redeem 2,000 points for a Business A voucher. A uses theirs. B gives theirs to User C. A and C both go to Business A's website and spend it.**

```
   points burned        voucher minted        transferred            redeemed
  ┌───────────┐        ┌───────────┐        ┌───────────┐        ┌───────────┐
  │ User A    │───────►│ voucher 1 │───────────────────────────►│ Business A│
  │ 2,000 pts │        │ code X    │                            │ checkout  │
  └───────────┘        └───────────┘                            └───────────┘
  ┌───────────┐        ┌───────────┐  void X, mint Y ┌────────┐      ▲
  │ User B    │───────►│ voucher 2 │────────────────►│ User C │──────┘
  │ 2,000 pts │        │ code X2   │   one hop only  │ code Y │
  └───────────┘        └───────────┘                 └────────┘
```

**Transfer rules — every one of these matters:**

1. **Void-and-remint.** The old code dies at the instant of transfer; a new code is minted for the recipient. Never move ownership of a live code. *(This is the Cardpool/Raise failure mode — the seller still knows the code.)*
2. **Verified YourTal user only.** No "anyone with this link" transfers. Open links are a phishing and laundering vector.
3. **One hop only.** C cannot pass to D. This is the elegant control: it preserves gifting, which is what users actually want, while killing the chain that would turn vouchers into a circulating currency.
4. **Holdback before transfer** — cannot transfer a voucher redeemed within the last N days (same rationale as the points holdback: fraud detection lags).
5. **Per-batch transferability flag**, set by the supplier at issuance and **shown to the user before they spend points.**
6. **Velocity caps and risk scoring** on transfers, both sending and receiving.
7. **Optional small transfer fee in points** — doubles as a sink and a fraud brake.

### 7.1 🔴 The compliance flag this raises

Points → voucher → **transferable** → redeemable for real goods is, in substance, a **transferable instrument with value**. That is materially closer to the stored-value line than the original non-transferable design, in both jurisdictions.

The rules above — one hop, verified recipient only, per-batch opt-in, holdback, caps — are what keep it arguable as a loyalty programme rather than a payment instrument. **They are compliance controls, not product polish, and counsel must review the transfer design specifically** before it ships. Do not let "users want to gift" quietly become "users can trade."

## 8. Merchant redemption — the settlement protocol

Business A must be connected to YourTal so that value is verified and deducted at *their* checkout. This is the same problem card networks solved, so use their shape: **authorize → capture → void / refund.**

```
  ┌──────────┐                    ┌───────────────┐                ┌──────────┐
  │ User C   │                    │ Business A    │                │ YourTal  │
  │ at       │  enters code Y     │ checkout      │                │ Voucher  │
  │ checkout │───────────────────►│               │                │ service  │
  └──────────┘                    │               │  authorize     │          │
                                  │               │───────────────►│ HOLD     │
                                  │               │◄───────────────│ 15 min   │
                                  │               │  auth_id, amt  │          │
                                  │  payment ok   │                │          │
                                  │               │  capture       │          │
                                  │               │───────────────►│ COMMIT   │
                                  │               │◄───────────────│ receipt  │
                                  │  order placed │                │          │
                                  └───────────────┘                └──────────┘
                                   payment fails → void → HOLD RELEASED
                                   order refunded → refund → value restored
```

### 8.1 The API

```
POST /v1/vouchers/authorize
  { code, amount, currency, merchant_order_ref, idempotency_key }
  → { authorization_id, amount_authorized, remaining_balance, expires_at }

POST /v1/vouchers/capture
  { authorization_id, final_amount, idempotency_key }
  → { receipt_id, amount_captured, remaining_balance }

POST /v1/vouchers/void
  { authorization_id, idempotency_key }          → releases the hold

POST /v1/vouchers/refund
  { receipt_id, amount, reason, idempotency_key } → restores value post-capture
```

**Non-negotiables:**
- **Idempotency key mandatory on every call.** Retries are certain; double-spends must be impossible.
- **Authorize requires an amount and a merchant order reference.** There is deliberately **no bare balance-lookup endpoint** for merchants — that is the enumeration surface that gets gift-card systems drained.
- **Capture cannot exceed authorize.** Enforced server-side.
- **Holds expire automatically** (15 min default), so an abandoned cart cannot lock a voucher forever.
- Once **settled**, a transaction can only be refunded, never voided — mirroring how gift-card APIs draw the same line at the settlement boundary.

### 8.2 Partial redemption policy — decide per batch, show the user

| Policy | Behaviour | Feels like |
|---|---|---|
| **Balance-carrying** | IDR 50,000 voucher on a IDR 30,000 order → IDR 20,000 remains | A gift card |
| **Single-use, forfeit remainder** | Same order → voucher closed, IDR 20,000 lost | A coupon |
| **Minimum spend** | Unusable below IDR X | A promo code |

All three are legitimate and merchants will want different ones. **The policy must be a per-batch flag, displayed prominently before the user spends their points.** A user who loses IDR 20,000 they did not expect to lose will never trust the store again — and they will be right not to.

### 8.3 When the merchant is offline or unintegrated

Never let integration be a precondition for a merchant to join. **Most SMB merchants in both markets are on Shopify or WooCommerce; for them, "install an app" is the difference between integrating and not integrating at all.** Degradation ladder:
1. **Manual portal** — staff type the code into the YourTal merchant portal, get a confirmation, apply a manual discount. **Available day one, zero integration.** This is how the first fifty merchants will actually work.
2. **In-store signed QR** — rotating Ed25519 QR from the user's app, scanned by staff on a phone.
3. **Offline verification** — signature verified locally against a cached public key, redemption queued for sync, with a documented conflict rule for the rare double-spend.

## 9. Integration surfaces, in order of merchant effort

| Surface | Effort for merchant | Phase | Notes |
|---|---|---|---|
| **Manual merchant portal** | None | 1 | The launch path. Do not skip it |
| **In-store signed QR** | Install a web app on a phone | 1 | Physical retail and F&B |
| **Hosted checkout widget** | Paste a script tag | 2 | Drop-in JS field on their checkout |
| **Shopify app** | Install from app store | 2 | Shopify has **no native support for third-party gift-card rewards** — an app is mandatory. Voucherify's plugin (sync codes so they work at native checkout) is the model to copy |
| **WooCommerce plugin** | Install plugin | 2 | The other half of SMB e-commerce |
| **Direct REST API** | Developer work | 2 | Custom stacks, larger merchants |
| **POS integrations** | Vendor-specific | 3 | Only for large chains, one at a time |

## 10. Security of the redemption network

Value now moves across an organisational boundary, on a merchant's infrastructure, which we do not control.

| Control | Detail |
|---|---|
| **Per-merchant credentials** | API key + **HMAC-SHA256 request signing**; mTLS for high-value merchants; scheduled key rotation |
| **No enumeration surface** | No bare balance endpoint; authorize needs amount + order ref; aggressive rate limits |
| **Failed-lookup alerting** | Repeated invalid codes from one merchant is *the* canonical signal of a compromised key or an enumeration attempt. Alert and auto-throttle |
| **Signed webhooks** | HMAC-SHA256 signature verification both directions |
| **Per-merchant velocity monitoring** | Redemption rate, average value, time-of-day profile; anomaly = investigate before settling |
| **Settlement hold** | Hold settlement across the dispute window; a compromised merchant key must not become irreversible cash |
| **Amount binding** | The authorized amount is bound to the merchant order ref; capture is checked against it |
| **Full audit trail** | Every state transition hash-chained per voucher, replayable, exportable to the merchant |
| **Kill switch** | Per-merchant, per-batch, and global. One call disables a compromised merchant's ability to redeem anything |

## 11. What this adds to the build

| Capability | Phase | Notes |
|---|---|---|
| **Points pricing engine** (`S`, `B`, demand multiplier, price lock) | 1 | Can launch with a fixed multiplier of 1.0 — but the formula and `B` must exist from day one |
| **Solvency invariant + coverage monitoring** | 1 | Two ledger entries and a dashboard. Cheapest insurance in the platform |
| **Unified store** (vouchers + merchandise, one catalogue, priced in points) | 1 | Digital goods first |
| **Merchant redemption API** (authorize/capture/void/refund) | 1 | Plus the manual portal fallback |
| **Manual merchant portal redemption** | 1 | The actual launch path |
| **Voucher transfer** (void-and-remint, one hop, verified recipient) | 2 | 🔴 counsel review before shipping |
| **Shopify app + WooCommerce plugin** | 2 | Where SMB merchants actually are |
| **Dynamic demand multiplier + economy dashboard** | 2 | Once there is enough data for demand signals to mean anything |
| **Economy owner (analyst/economist)** | 1 | A role, not a feature. Hire before launch, not after the first drift |

---

## 12. The honest assessment

This subsystem is where the platform is most likely to fail quietly. The failure modes are not crashes:

| Failure | How it happens |
|---|---|
| **Insolvency by unfunded faucet** | Points minted for promos and sister apps with no cash behind them; discovered a year later |
| **Arbitrage by supplier** | One business underprices and drains margin until someone notices |
| **Inflation** | Issuance outruns inventory; users conclude the platform devalued their effort and leave loudly |
| **Redemption failure** | The voucher does not work at checkout — the worst experience in the product, at the moment of maximum expectation |

All four are prevented by things that are cheap now and expensive later: the pricing formula, the coverage ratio, the auth/capture protocol, and a person whose job is to watch the economy.

**Build the ledger, the pricing formula and the coverage dashboard before you build the store.**

---

## Sources

**Game economies:** [Designing game economies](https://medium.com/@msahinn21/designing-game-economies-inflation-resource-management-and-balance-fa1e6c894670) · [Gold sink](https://en.wikipedia.org/wiki/Gold_sink) · [Preventing MMO inflation](https://salivity.github.io/game-development/article/how-to-prevent-inflation-in-mmo-virtual-economies) · [Currency sinks in F2P](https://salivity.github.io/game-development/article/the-purpose-of-currency-sinks-in-free-to-play-games) · [Machinations on inflation](https://machinations.io/articles/what-is-game-economy-inflation-how-to-foresee-it-and-how-to-overcome-it-in-your-game-design) **Loyalty pricing:** [Dynamic redemption values](https://www.currencyalliance.com/insights/maximize-loyalty-roi-with-dynamic-redemption-values) · [It's (almost) never 1%](https://www.currencyalliance.com/insights/its-almost-never-1-how-to-price-loyalty-rewards) · [Dynamic award pricing](https://www.arrivia.com/insights/dynamic-award-pricing/) · [Redemption ecosystems](https://www.currencyalliance.com/insights/redemption-ecosystems-beyond-the-loyalty-reward-catalog) **Redemption protocol:** [Adyen Stored Value API](https://docs.adyen.com/payment-methods/gift-cards/stored-value-api) · [Clover gift card API](https://docs.clover.com/dev/docs/gift-card-api) · [Authorize.net auth/capture/void](https://developer.authorize.net/api/reference/features/payment-transactions.html) **Merchant integration:** [Voucherify Shopify](https://docs.voucherify.io/integrations/shopify) · [Shopify gift cards as loyalty reward](https://community.shopify.com/t/how-do-i-offer-gift-cards-as-a-loyalty-reward-on-shopify/422220) · [WooCommerce gift card plugins](https://www.flycart.org/blog/best-woocommerce-gift-card-plugins)
