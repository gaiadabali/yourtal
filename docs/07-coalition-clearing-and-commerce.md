# YourTal — Coalition Clearing & Commerce

**Date:** 2026-09-18
**Why this doc exists:** the reward comes from the **business**, not from YourTal — points, merchandise, vouchers, or a combination — and points earned at Business A are redeemable against Business B's inventory. That makes YourTal a **coalition loyalty operator running a clearing house**, and the merchandise leg makes it a **marketplace shipping physical goods**. Neither was scoped in the first pass.

---

## 1. What YourTal actually is now

```
  BUSINESS A                 YOURTAL                    BUSINESS B
  (advertiser)              (operator)                  (redeemer)
      │                         │                            │
      │ pays cash for reach     │                            │
      │ ─────────────────────►  │                            │
      │ funds reward inventory  │                            │
      │ (points / vouchers /    │                            │
      │  merchandise)           │                            │
      │ ─────────────────────►  │                            │
      │                         │  user earns points         │
      │                         │  watching A's campaign     │
      │                         │            │               │
      │                         │            ▼               │
      │                         │  user redeems those points │
      │                         │  against B's merchandise   │
      │                         │ ──────────────────────────►│
      │                         │                            │
      │                         │  YourTal OWES B            │
      │                         │  for value B honoured      │
      │                         │ ──────── settlement ──────►│
```

YourTal is the **issuer of the currency, the clearing house between partners, and the holder of the liability in between.** This is the Flybuys / airline-alliance / mall-gift-card structure, and it has a well-established shape.

## 2. The clearing model

The industry pattern, confirmed by the research, is:

> When a member **earns** points at a partner, that partner **pays the operator** — it is buying the currency it just issued. When a member **redeems** at a partner, the operator **pays that partner** for the value it honoured. Over a settlement cycle these obligations are **netted into one balance per partner**.

### 2.1 Two prices, and the spread is the business model

| Price | Who pays | What it is |
|---|---|---|
| **Issuance price `P_issue`** | Business → YourTal | What a business pays per point it gives away. E.g. **IDR 8 per point**. |
| **Backing rate `B`** | — | The currency value YourTal commits to deliver per point. **Platform-set, never published to users, always < `P_issue`.** E.g. **IDR 6 per point**. |
| **Settlement value `S`** | YourTal → Business | Declared per listing by the supplier — what we pay them when their item is redeemed. Points price is then computed as `S / B`. |
| **Spread** | — | `P_issue − B` = **IDR 2 per point of clearing margin**, on top of the cash campaign fee. |
| **Breakage** | — | Points that expire unredeemed. The operator keeps these by default; large partners will negotiate a share. |

> **Suppliers declare `S`, they do not set the points price.** If they could, any business could underprice and drain the platform. Full derivation, worked example and the demand multiplier in [`09`](09-points-economy-and-redemption.md) §4.

Two funding models, and the choice matters a great deal:

- **Pre-purchase (recommended).** Business buys a block of points upfront at wholesale; liability transfers from YourTal to the business at purchase; points are drawn down as they are awarded. Cash is in the door. A business that goes bust does not leave YourTal holding an unfunded liability.
- **Post-paid per-point fee.** Business is invoiced monthly for points issued. Easier to sell, but YourTal carries credit risk on every point awarded before payment clears.

**Recommendation: pre-purchase only at launch.** Move a proven partner to post-paid with a credit limit, never an unproven one.

### 2.2 Settlement run

```
 nightly   accrue: points issued by partner, points redeemed at partner,
           merchandise fulfilled, vouchers honoured, adjustments, refunds

 weekly    net per partner  →  statement
           ─ owed to YourTal   (points they issued, media fees, platform fee)
           ─ owed by YourTal   (points redeemed against their inventory,
                                 merchandise shipped, vouchers honoured)
           ─ NET = one number, one direction

 payout    Xendit (ID) / Stripe or direct credit (AU)
           with a dispute window before funds move
```

Every statement is **immutable, signed, and reproducible from ledger entries**. A partner must be able to click any number and see the underlying events. This is the single most common source of partner disputes in coalition programmes, and the fix is cheap if built in from the start and brutally expensive to retrofit.

### 2.3 The float — flag this to counsel

Between a business pre-purchasing points and YourTal paying another business for redemption, **YourTal holds money that economically belongs to others.** That is a float.

- In Australia this may engage **client-money / trust-account** obligations depending on structure, and it feeds the **$200 M APRA stored-value threshold** calculation.
- In Indonesia it is a prepayment liability with tax and, potentially, payment-regulation implications.

**Design response:** hold partner float in a **segregated account**, never commingled with operating cash; report the float balance daily; never fund operating expenses from it. This is cheap discipline now and is the difference between a clean audit and an existential problem later. 🔴 **Needs counsel in both jurisdictions before the first pre-purchase.**

### 2.4 Cross-border is forbidden

An Indonesian business's points cannot be redeemed against an Australian business's inventory, and vice versa. Two clearing houses, two float accounts, two sets of partner statements, one codebase. This is the same country-isolation rule as everything else, and it is what keeps each market independently licensable.

## 3. Rewards are always points — inventory is a separate relationship

> **Corrected.** An earlier draft had businesses funding a campaign with points *or* vouchers *or* merchandise. The model is cleaner than that: **the campaign reward is always points.** Vouchers and merchandise are *inventory* the business supplies to the shared store, priced in points. Two independent relationships — see [`09`](09-points-economy-and-redemption.md) §2.

| Relationship | What the business does | Money direction |
|---|---|---|
| **Advertiser** | Uploads video, authors questions, **pre-purchases points** | Business → YourTal |
| **Supplier** | Lists vouchers/merchandise at a declared **settlement value** | YourTal → Business on redemption |
| **Redeemer** | Honours the voucher at their own checkout via the redemption API | (settled as above) |

**A business doing both #1 and #2 nets off.** They pay for points issued; they get paid for redemptions honoured. If those balance, almost no cash moves — which is the easiest thing to sell in the platform: *"fund your campaign with your own inventory."*

What YourTal carries by inventory type:

| Type | Fulfilment | Risk YourTal carries |
|---|---|---|
| **Voucher (digital)** | Instant issue; merchant honours later via API | Merchant refuses or fails to honour |
| **Digital goods** (pulsa, top-ups, subscriptions) | Instant, via supplier API | Supplier outage |
| **Merchandise** | **Physical shipment** by the merchant | Non-delivery, damage, stockout |

**Merchandise is the expensive one** — it drags in a full commerce stack. Phase it; start with digital.

## 4. Commerce & fulfilment (the merchandise leg)

### 4.1 Scoping decision: merchant-fulfilled by default 🚩

**YourTal should never hold inventory.** The merchant ships. YourTal orchestrates, tracks and settles.

| Model | YourTal's role | Recommendation |
|---|---|---|
| **Merchant-fulfilled (dropship)** | Order routing, label generation, tracking, SLA enforcement, settlement | **Launch model** |
| **Platform-fulfilled (3PL warehouse)** | Inbound, storage, pick/pack, ship, returns | Only for a proven, high-volume merchandise category |
| **Digital goods** (e-vouchers, top-ups, subscriptions) | Instant delivery via API | **Launch alongside — no logistics at all** |

**Start with digital merchandise.** Pulsa/data top-ups, e-vouchers, game credits, streaming subscriptions are enormously popular in Indonesia, need zero logistics, have instant fulfilment and near-zero dispute rates. They make the rewards store feel full from day one while the physical-goods pipeline is still being built.

### 4.2 What the commerce domain needs

```
Catalogue      product, variants, images, price-in-points, price-in-cash,
               merchant, category, restrictions (age, jurisdiction, shipping zone)
Inventory      stock levels, reservations with TTL, oversell protection,
               low-stock alerts, auto-delist at zero
Order          cart → reserve → burn points → order → fulfil → deliver → close
               with a compensating saga at every step
Address        address book, ID subdistrict (kecamatan/kelurahan) hierarchy,
               AU suburb/postcode validation
Shipping       zones, rates, courier selection, label generation, tracking
Returns        RMA, refund-to-points, restocking, evidence capture
Disputes       non-delivery, damaged, not-as-described, SLA breach
```

**The critical transaction is points-burn + stock-reserve.** These are in different services and must not diverge:

```
1. reserve stock (TTL 15 min)      → reservation_id
2. debit points (idempotent)       → transfer_id
3. create order                    → order_id
4. confirm reservation
   ─ any step fails → compensate: release reservation, reverse points transfer
   ─ every step idempotent; the saga is replayable and its state is durable
```

Never debit points before the stock is reserved. Never ship before the debit is confirmed.

### 4.3 Courier integration

- **Indonesia:** JNE, J&T, SiCepat, Ninja Xpress, AnterAja, plus instant couriers (GoSend, Grab). Integrate via an **aggregator** (Biteship, Shipper) rather than one-by-one — one contract, one API, rate shopping across couriers included.
- **Australia:** Australia Post, Sendle, Aramex; aggregate via Shippit or similar.

Build a **Shipping Provider** interface and a single adapter at launch. Do not integrate four couriers directly.

### 4.4 Consumer law applies to goods obtained with points

This surprises people and needs stating plainly: in Australia, **Australian Consumer Law guarantees apply to goods** — acceptable quality, fit for purpose, matching description — and they are **not waived because the customer paid in points instead of dollars**. Indonesia's consumer protection law is similar in intent.

**Implication:** returns, refunds and remedies must be real, and the merchant agreement must make clear that the **merchant is the supplier** and bears the consumer-guarantee obligation, with YourTal as the facilitator. Then actually enforce it — SLA scoring, delisting for repeat failures, and an escrowed settlement hold long enough to cover the dispute window.

### 4.5 Indonesian e-commerce regulation 🔴

**Permendag No. 19 of 2026**, effective **8 June 2026**, replaced Permendag 31/2023 and now covers eight business models including marketplaces and social commerce. The provisions that hit us directly:

- Platforms **must reject registration from any seller who cannot show a valid business licence** — typically an **NIB** in the trade sector — plus **proof that products meet applicable standards**.
- Existing sellers have **18 months** to complete licensing; new sellers **6 months** from registration.
- **Foreign sellers** must supply a legalised business licence, proof of product-standard compliance, a bank account number, **Bahasa Indonesia product descriptions**, and country of shipment. If not, the platform **must** reject them.

**Implication:** merchant onboarding is not a form — it is a **KYB pipeline with NIB verification, document capture and expiry tracking**, and it is a hard gate before any merchant can list physical goods. Build it as part of the merchant portal in the same phase as merchandise, not after.

Also flag for the finance workstream: Indonesian marketplaces carry **tax-collection/withholding obligations** on seller income. 🔴 Confirm the current position with a local tax adviser before the first merchandise order settles.

## 5. Why the e-commerce exists — and the trap in it

The cross-redemption ("earn at A, spend at B") is the **whole reason the coalition is worth more than the sum of its parts.** A user who watches a bank's 20-minute explainer and redeems a coffee voucher experiences a platform, not an ad. No single business could offer that.

**The trap:** cross-redemption means **YourTal is liable for value it did not receive the cash for yet.** If Business A's points are earned this month and redeemed against Business B's merchandise next month, YourTal must have already collected from A and must now pay B. Pre-purchase funding closes that gap. Post-paid funding opens it. **This is why the funding model is a 🚩 blocking decision and not a commercial detail.**

## 6. What this adds to the build

| New capability | Phase | Notes |
|---|---|---|
| **Partner points funding** (pre-purchase, drawdown, allocation) | 1 | Required the moment a business funds points |
| **Clearing & settlement** (accrual, netting, statements, payout) | 1–2 | Weekly netting can start manual with ≤10 partners; automate by phase 2 |
| **Merchant KYB** (NIB verification, documents, expiry) | 2 | Hard gate for merchandise under Permendag 19/2026 |
| **Digital merchandise** (top-ups, e-vouchers, subscriptions) | 2 | No logistics — ship this first |
| **Physical merchandise** (catalogue, inventory, orders, shipping, returns) | 3 | Full commerce domain |
| **Float segregation & reporting** | 1 | Cheap now, existential later |

**The honest cost of the merchandise leg is roughly one additional pod for two phases.** It is the right feature — it is what makes cross-redemption real — but it should be sequenced behind the watch-and-earn loop, and it should start with digital goods.
