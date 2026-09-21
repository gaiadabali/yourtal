# YourTal — Legal Positions Register

**Date:** 2026-09-19
**Status:** Positions taken on the basis of published official sources, **without engaged counsel**, by founder decision.

---

## What this document is, and what it is not

**It is:** every legal position the plan relies on, each stated explicitly, each traced to a primary or official source, each with the residual risk named. It is the artefact that replaces a counsel opinion in the short term, and it is what makes a _later_ lawyer review cheap — a lawyer reviews a register in hours, not a whole business in weeks.

**It is not legal advice, and research is not a substitute for it.** Published sources tell you what a rule says. Counsel tells you how a regulator applies it to _your specific facts_, which is precisely where the risk lives in a novel product like this one.

**The honest framing:** proceeding without counsel is a legitimate cost decision for a pre-revenue company, and it is a bet. This register is how you keep the bet bounded, visible and reversible.

## The distinction that matters: advisory counsel vs required functionaries

Skipping _advisory_ counsel is a choice. Some roles are not advisory and cannot be skipped:

| Role                                                      | Status                     | Why                                                                                           |
| --------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| Advisory lawyer (opinions on classification, structuring) | **Skipped by decision**    | This register replaces it, with the risk accepted below                                       |
| **Notaris** (Indonesian notary)                           | **Mandatory**              | PT / PT PMA formation is a notarial act under Indonesian law. There is no research substitute |
| Local corporate services provider                         | **Practically mandatory**  | NIB/OSS, PSE registration and domicile in practice require a local agent                      |
| Tax consultant (Indonesia)                                | **Strongly advised**       | Marketplace withholding obligations carry direct financial exposure and change often          |
| Auditor / accountant                                      | **Required before launch** | Points liability and breakage policy are accounting judgements, not legal ones                |

**Budget for the notary and the corporate services provider. They are not the thing being skipped.**

---

## Positions taken

Confidence: **High** = the rule is explicit and directly on point · **Medium** = the rule is clear but our application of it is a judgement · **Low** = genuinely uncertain, proceeding anyway with mitigation.

### Indonesia

| #     | Position                                                                                                                                                                                                                                                                                                   | Basis                                                                              | Confidence | Residual risk                                                                                                                                                                                            | Re-verify by          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| ID-1  | YourTal Points are a loyalty currency, not e-money, because users cannot buy them, cannot transfer them, they expire, and there is no published fixed cash rate                                                                                                                                            | BI Reg 10/2025 scope; the distinguishing features of licensed e-money              | **Medium** | If a regulator looks through the structure to substance, the platform is an unlicensed PJP. **This is the single largest legal exposure in the plan**                                                    | 2026-12-19            |
| ID-2  | A closed loop with no cash withdrawal does not require PJP licensing                                                                                                                                                                                                                                       | BI Reg 10/2025 activity scope                                                      | Medium     | Same as ID-1. The moment cash-out ships, this position is void and licensing is unavoidable                                                                                                              | 2026-12-19            |
| ID-3  | Skill-based and deterministic game mechanics are not gambling                                                                                                                                                                                                                                              | Indonesian gambling prohibition applies to games of chance for money or prizes     | **High**   | Low, provided no chance element is ever introduced without review                                                                                                                                        | 2026-12-19            |
| ID-4  | Chance-based prize draws require MOSA draw + promotion permits and a 10% social-welfare contribution                                                                                                                                                                                                       | MOSA Reg. 3/2024                                                                   | **High**   | Low. The rule is explicit. Simply do not run one without the permits                                                                                                                                     | 2026-12-19            |
| ID-5  | Prediction/guessing games are prohibited even when free and in-app                                                                                                                                                                                                                                         | Explicit in the prohibition                                                        | **High**   | Low, and it is an absolute bar — see the red lines below                                                                                                                                                 | 2026-12-19            |
| ID-6  | PSE registration with Komdigi is required before serving Indonesian users                                                                                                                                                                                                                                  | PP 71/2019                                                                         | **High**   | Low, but it is a launch blocker. Non-registration risks access blocking                                                                                                                                  | Before first ID user  |
| ID-7  | Consent must be specific, unambiguous and preceded by stated purpose; sanctions bite from 16 Jan 2027                                                                                                                                                                                                      | UU 27/2022; GR 33/2026                                                             | **High**   | Low if the consent service is built as specified. The date is fixed and known                                                                                                                            | **2026-11-16**        |
| ID-8  | Breach notification is 3×24 hours to subjects and the authority                                                                                                                                                                                                                                            | UU PDP Art. 46                                                                     | **High**   | Low, but the runbook must actually exist and be rehearsed                                                                                                                                                | 2026-12-19            |
| ID-9  | Physical-goods sellers must hold a valid NIB, and the platform must reject those who do not                                                                                                                                                                                                                | Permendag 19/2026, in force 8 Jun 2026                                             | **High**   | Low. Hard gate before merchandise ships                                                                                                                                                                  | 2026-12-19            |
| ID-10 | Charitable fundraising requires a PUB permit; YourTal avoids this by never holding charitable funds, with a permitted partner as the collector                                                                                                                                                             | Law 9/1961; MoSA Regs 8/2021, 2024                                                 | Medium     | Structure must be genuine, not nominal. Funds must never touch a YourTal account                                                                                                                         | 2026-12-19            |
| ID-11 | Marketplace tax withholding on seller income applies                                                                                                                                                                                                                                                       | PMK on marketplaces as tax collector                                               | **Low**    | **Get a tax consultant before the first merchandise settlement.** This is financial, immediate and changes often                                                                                         | **2026-11-18**        |
| ID-12 | **Minimum age 18** — ⚠️ **no citation yet.** Indonesian law is not uniform: KUHPerdata Art. 330 uses 21 for contractual capacity, while the PDP Law and others treat under-18 as a child requiring parental consent. A rewards platform forms a contract and processes personal data, so both regimes bite | Currently a **placeholder**, implemented conservatively in `packages/jurisdiction` | **Low**    | 18 may be wrong for contractual capacity in Indonesia. **Resolve before launch:** confirm the age for (a) contracting and (b) data-processing consent, and cite both. 21 is the safer default until then | **Before first user** |

### Australia

| #    | Position                                                                                                                                                                | Basis                                                                                | Confidence | Residual risk                                                                                                                    | Re-verify by               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| AU-1 | A closed-loop, non-reloadable reward voucher may fall within gift-facility relief                                                                                       | ASIC Instrument 2026/167 s11                                                         | Medium     | ASIC's own guidance says test the _actual product_ against the instrument. Our product is novel                                  | 2026-12-19                 |
| AU-2 | A reloadable wallet with withdrawal requires an AFSL or an exclusion                                                                                                    | Corporations Act s911A; low-value NCP relief caps ($1,000 per user / $10M aggregate) | **High**   | Low, because we are not doing it. Voids immediately if cash-out ships                                                            | 2026-12-19                 |
| AU-3 | Games of skill require no trade-promotion permit; chance-based ones need permits in NSW, ACT, SA, NT above stated thresholds                                            | State fair-trading regimes                                                           | **High**   | Low, and thresholds are published ($3k ACT, $5k SA, $10k NSW)                                                                    | 2026-12-19                 |
| AU-4 | Consumer guarantees apply to goods obtained with points                                                                                                                 | Australian Consumer Law                                                              | **High**   | Low, but it must be operable — real returns, real remedies                                                                       | 2026-12-19                 |
| AU-5 | **Forward statements to merchants about redemption or breakage rates require a reasonable basis**                                                                       | ACCC v Scoopon (2013), A$1M penalty                                                  | **High**   | **Low only if enforced.** Until the pilot produces our own data, no such statement may be made. This is a sales-training control | 2026-12-19                 |
| AU-6 | NDB scheme allows 30 days to _assess_, then notify as soon as practicable                                                                                               | Privacy Act s26WH(2), s26WK/WL                                                       | **High**   | Low. Note this is an assessment window, not a notification deadline — plan to Indonesia's 72 hours                               | On assent, else 2026-12-19 |
| AU-7 | Targeted advertising will require consent under the reform; build to the future rule                                                                                    | Exposure draft, 31 Aug 2026                                                          | Medium     | The draft may change. Building to the stricter reading costs little                                                              | On assent, else 2026-12-19 |
| AU-8 | ACNC-registered charities are deemed authorised to fundraise in most states                                                                                             | State harmonisation reforms                                                          | **High**   | Low                                                                                                                              | 2026-12-19                 |
| AU-9 | **Minimum age 18** — 18 is the general age of contractual capacity, but this is asserted rather than cited, and the Privacy Act reform adds child-protection provisions | Needs a citation                                                                     | Medium     | Confirm alongside ID-12                                                                                                          | **Before first user**      |

---

## Red lines — absolute, not negotiable

These carry criminal exposure, licence exposure, or a regulator precedent directly on point. **No one may authorise these without engaged counsel, regardless of commercial pressure.**

1. **No prediction or guessing games**, even free, even in-app. Explicitly prohibited in Indonesia.
2. **No chance-based prize mechanic in Indonesia without MOSA permits** and the 10% contribution.
3. **No cash withdrawal, in either market**, until licensed. This is the position that converts a loyalty programme into an unlicensed payments business.
4. **No user purchase of points.** Ever. It is the single clearest e-money indicator.
5. **No forward breakage or redemption claim to a merchant** without our own data behind it. Already litigated in Australia.
6. **No sensitive-category inference** — health, pregnancy, religion, politics, sexuality, ethnicity, financial distress.
7. **No physical-goods merchant onboarded without a verified NIB.**
8. **No charitable funds held in a YourTal account.**
9. **No launch in Indonesia before PSE registration.**
10. **No user-level data export to any advertiser**, at any account tier.

## Triggers that force engaging counsel regardless of budget

| Trigger                                                                 | Why it cannot wait                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Any move toward **cash-out**                                            | Licensing, capital and entity structure all change                  |
| **Revenue above a set threshold**, or the first institutional raise     | Diligence will demand opinions; getting them late is more expensive |
| Any **regulator contact**, however informal                             | Do not answer a regulator without counsel                           |
| **Australia launch**                                                    | A second regime, mid-reform, with an active enforcement history     |
| The first **cross-border data flow**                                    | ID/AU isolation is a legal design, not an engineering preference    |
| A **merchant dispute above a threshold**, or any consumer-law complaint | Precedent-setting                                                   |

## How this register stays honest

- **Every position names its source.** A position without a citation is a guess and must be marked as one.
- **Re-verified quarterly**, and **every position now carries its own `Re-verify by` date**. Both regimes are actively changing: GR 33/2026 bites 16 Jan 2027, the Australian reform is mid-passage, Permendag 19/2026 is new.

### How the `Re-verify by` dates are derived

Until 2026-09-21 this section said "re-verified quarterly" and **not one position carried a date**. A cadence with no anchor cannot be measured, so nothing could ever be shown to be overdue — the register stated its own discipline and provided no way to check it. The dates are therefore **derived by rule, not chosen per position**, so a later reader can recompute them and disagree with the rule rather than having to trust twenty-one separate judgements:

| the position is…                       | re-verify by                         | why                                                                                                                                                |
| -------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| ordinarily settled (High or Medium)    | **anchor + 3 months** = `2026-12-19` | the stated quarterly cadence, now with an anchor                                                                                                   |
| rated **Low** confidence               | **anchor + 2 months** = `2026-11-18` | ID-11. Low means "proceeding anyway with mitigation", and mitigation decays                                                                        |
| governed by a **known statutory date** | **that date − 2 months**             | ID-7: GR 33/2026 sanctions bite 16 Jan 2027, so `2026-11-16` — two months is time to change behaviour, not just to notice                          |
| awaiting a **reform in passage**       | **on assent**, else quarterly        | AU-6, AU-7. Assent is the event that matters; the quarterly date is the floor, not the trigger                                                     |
| **uncited** — a guess carried openly   | **before the first user**            | ID-12 and AU-9. A guess with a quarterly date is still a guess, and an age rule is wrong at the moment the first person it is wrong about signs up |
| a **precondition to operating**        | before that operation                | ID-6: PSE registration is required _before_ serving Indonesian users, so a calendar date is the wrong instrument                                   |

**The anchor is 2026-09-19**, the date the register was audited as a whole. It is deliberately **not** claimed as a per-position verification event — nobody checked twenty-one positions individually that day, and a column asserting they did would be the kind of unearned precision this register exists to avoid. It is the earliest date the whole document is known to have been reviewed, which is the honest anchor and the conservative one.

**Note:** the register holds **21** positions, twelve Indonesian and nine Australian. Task YT-0010 described it as 19; the count was never recomputed after positions were added.

- **Any change to the product re-opens the affected position.** The register is reviewed at every phase gate, not annually.
- **Counsel review is scheduled, not abandoned** — budget one review of this register before the Australia launch or the first institutional raise, whichever comes first. Reviewing a register is a fraction of the cost of reviewing a business.

## Risk accepted

Proceeding without advisory counsel is a **deliberate, documented decision** by the founder, recorded here so it is a choice rather than an oversight.

**The exposure is concentrated in ID-1 and ID-2** — the position that YourTal Points are not e-money. Every other position is either explicit in published rules or avoided by design. If one thing were to be paid for early, it is a single written opinion on that one question in Indonesia. It is a narrow question, it would be comparatively cheap, and it is the one that could stop the business rather than merely cost it money.

---

## Counsel-substitution risk acceptance — **SIGNED, DEVELOPMENT STAGE** (YT-0012)

> ✅ **In force for the development stage, signed 2026-09-21 on the founder's explicit instruction**, given in session `yourtal-a4`, so that this ticket stops gating 28 downstream tasks while nothing is yet built for real users.
>
> ⚠️ **Read what this signature is and is not.** It is a **development-stage acceptance**: no user, no entity, no regulator and no merchant exists yet, so the risk being accepted is currently theoretical. It is **not** the instrument to rely on once any of those exist. **It must be re-executed by the founder personally — reading it, not instructing it — before the earliest of: the first real user, entity formation (YT-0013), PSE registration (YT-0014), or any regulator contact.** That re-execution is a criterion of YT-0013 and should fail loudly if skipped.
>
> The draft version of this section said a risk acceptance completed on someone's behalf asserts that a person accepted a risk who did not. That objection is answered here **by narrowing the claim, not by ignoring it**: what is recorded below is the founder's instruction to proceed at development stage, dated and attributed to the session that received it — not a representation that the founder has personally read and weighed each clause.

### 1 · The decision

The founder proceeds with the YourTal plan **without engaging advisory counsel**, relying on this register in its place. This is a cost decision made with the alternative understood: published sources state what a rule says; counsel states how a regulator applies it to these specific facts, and that is where the risk in a novel product lives.

**What is not being skipped**, and is separately budgeted: the **notaris** (a notarial act, no research substitute), a **local corporate services provider** (NIB/OSS, PSE, domicile), a **tax consultant**, and an **auditor** before launch. See _the distinction that matters_ above.

### 2 · The concentration, explicitly acknowledged

The founder acknowledges that this exposure is **not spread across the 21 positions — it is concentrated in two**:

- **ID-1** — YourTal Points are a loyalty currency, not e-money. Confidence **Medium**.
- **ID-2** — a closed loop with no cash withdrawal does not require PJP licensing. Confidence **Medium**.

If a regulator looks through the structure to the substance, the platform is **an unlicensed payments business**. Every other position is either explicit in a published rule or avoided by design. **This is the one that stops the business rather than costing it money**, and it is accepted knowingly.

Two structural facts make the acceptance narrower than it sounds, and both must hold for it to stay valid: **no user may purchase points** and **no cash withdrawal may ship**, in either market. Both are already red lines 3 and 4 above. **If either red line is crossed, this acceptance lapses automatically** and counsel is required before the change ships — that is the point of the lapse, not a formality.

### 3 · Triggers that force counsel regardless of budget

The six triggers in _Triggers that force engaging counsel regardless of budget_ above are adopted as part of this acceptance. Signing this adopts them; they stop being a list someone wrote and become a commitment.

Two of the six carried no number, which is the defect the settlement-materiality threshold had until 2026-09-21 — a threshold with no number cannot be crossed. **Both are set to `any`:**

- _"Revenue above a set threshold"_ → **`any`**
- _"A merchant dispute above a threshold"_ → **`any`**

`any` is chosen deliberately over a figure. It is **definite**, which is the property that was missing, and it errs toward _more_ counsel rather than less — so it is the one answer that is safe to set at development stage without the founder weighing a number. Both should be revisited at re-execution, when there is revenue and there are merchants to have disputes with; until then neither trigger can fire, because neither condition can occur.

### 4 · Budget reserved for the narrow opinion

A budget line is reserved for **one written opinion on the e-money classification question in Indonesia** (ID-1/ID-2) — not a general retainer, not a review of the whole business.

- **Amount reserved:** **not yet set — deferred to YT-0013 (entity formation), and a criterion of it**
- **Spent by:** the earlier of the first institutional raise, the Australia launch, or the first regulator contact

**The amount is deliberately not invented here.** An unfunded intention is not a reservation, and this is the single opinion the register nominates as worth buying first — so a number made up by a session to clear a checkbox would be the settlement-materiality failure with a currency symbol on it. What is committed now is the **scope and the trigger**; the figure attaches at YT-0013, which is the first point at which real money is being committed to Indonesian structure anyway.

### 5 · Signature

|             |                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Status**  | ✅ **IN FORCE — DEVELOPMENT STAGE ONLY**                                                                                      |
| **Signed**  | Hansel, founder — instruction given in session `yourtal-a4` and recorded by it                                                |
| **Date**    | 2026-09-21                                                                                                                    |
| **Expires** | On the earliest of: first real user · entity formation (**YT-0013**) · PSE registration (**YT-0014**) · any regulator contact |
| **Review**  | On any change to ID-1 or ID-2, on any red-line crossing, and at each `Re-verify by` date above                                |

**What would make this signature void rather than merely expired:** shipping a user purchase of points, or shipping cash withdrawal (red lines 3 and 4). Both are the premises ID-1 and ID-2 rest on, so crossing either does not weaken this acceptance — it removes the thing being accepted.
