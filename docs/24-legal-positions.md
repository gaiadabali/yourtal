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

| #     | Position                                                                                                                                                                                                                                                                                                   | Basis                                                                              | Confidence | Residual risk                                                                                                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID-1  | YourTal Points are a loyalty currency, not e-money, because users cannot buy them, cannot transfer them, they expire, and there is no published fixed cash rate                                                                                                                                            | BI Reg 10/2025 scope; the distinguishing features of licensed e-money              | **Medium** | If a regulator looks through the structure to substance, the platform is an unlicensed PJP. **This is the single largest legal exposure in the plan**                                                    |
| ID-2  | A closed loop with no cash withdrawal does not require PJP licensing                                                                                                                                                                                                                                       | BI Reg 10/2025 activity scope                                                      | Medium     | Same as ID-1. The moment cash-out ships, this position is void and licensing is unavoidable                                                                                                              |
| ID-3  | Skill-based and deterministic game mechanics are not gambling                                                                                                                                                                                                                                              | Indonesian gambling prohibition applies to games of chance for money or prizes     | **High**   | Low, provided no chance element is ever introduced without review                                                                                                                                        |
| ID-4  | Chance-based prize draws require MOSA draw + promotion permits and a 10% social-welfare contribution                                                                                                                                                                                                       | MOSA Reg. 3/2024                                                                   | **High**   | Low. The rule is explicit. Simply do not run one without the permits                                                                                                                                     |
| ID-5  | Prediction/guessing games are prohibited even when free and in-app                                                                                                                                                                                                                                         | Explicit in the prohibition                                                        | **High**   | Low, and it is an absolute bar — see the red lines below                                                                                                                                                 |
| ID-6  | PSE registration with Komdigi is required before serving Indonesian users                                                                                                                                                                                                                                  | PP 71/2019                                                                         | **High**   | Low, but it is a launch blocker. Non-registration risks access blocking                                                                                                                                  |
| ID-7  | Consent must be specific, unambiguous and preceded by stated purpose; sanctions bite from 16 Jan 2027                                                                                                                                                                                                      | UU 27/2022; GR 33/2026                                                             | **High**   | Low if the consent service is built as specified. The date is fixed and known                                                                                                                            |
| ID-8  | Breach notification is 3×24 hours to subjects and the authority                                                                                                                                                                                                                                            | UU PDP Art. 46                                                                     | **High**   | Low, but the runbook must actually exist and be rehearsed                                                                                                                                                |
| ID-9  | Physical-goods sellers must hold a valid NIB, and the platform must reject those who do not                                                                                                                                                                                                                | Permendag 19/2026, in force 8 Jun 2026                                             | **High**   | Low. Hard gate before merchandise ships                                                                                                                                                                  |
| ID-10 | Charitable fundraising requires a PUB permit; YourTal avoids this by never holding charitable funds, with a permitted partner as the collector                                                                                                                                                             | Law 9/1961; MoSA Regs 8/2021, 2024                                                 | Medium     | Structure must be genuine, not nominal. Funds must never touch a YourTal account                                                                                                                         |
| ID-11 | Marketplace tax withholding on seller income applies                                                                                                                                                                                                                                                       | PMK on marketplaces as tax collector                                               | **Low**    | **Get a tax consultant before the first merchandise settlement.** This is financial, immediate and changes often                                                                                         |
| ID-12 | **Minimum age 18** — ⚠️ **no citation yet.** Indonesian law is not uniform: KUHPerdata Art. 330 uses 21 for contractual capacity, while the PDP Law and others treat under-18 as a child requiring parental consent. A rewards platform forms a contract and processes personal data, so both regimes bite | Currently a **placeholder**, implemented conservatively in `packages/jurisdiction` | **Low**    | 18 may be wrong for contractual capacity in Indonesia. **Resolve before launch:** confirm the age for (a) contracting and (b) data-processing consent, and cite both. 21 is the safer default until then |

### Australia

| #    | Position                                                                                                                                                                | Basis                                                                                | Confidence | Residual risk                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AU-1 | A closed-loop, non-reloadable reward voucher may fall within gift-facility relief                                                                                       | ASIC Instrument 2026/167 s11                                                         | Medium     | ASIC's own guidance says test the _actual product_ against the instrument. Our product is novel                                  |
| AU-2 | A reloadable wallet with withdrawal requires an AFSL or an exclusion                                                                                                    | Corporations Act s911A; low-value NCP relief caps ($1,000 per user / $10M aggregate) | **High**   | Low, because we are not doing it. Voids immediately if cash-out ships                                                            |
| AU-3 | Games of skill require no trade-promotion permit; chance-based ones need permits in NSW, ACT, SA, NT above stated thresholds                                            | State fair-trading regimes                                                           | **High**   | Low, and thresholds are published ($3k ACT, $5k SA, $10k NSW)                                                                    |
| AU-4 | Consumer guarantees apply to goods obtained with points                                                                                                                 | Australian Consumer Law                                                              | **High**   | Low, but it must be operable — real returns, real remedies                                                                       |
| AU-5 | **Forward statements to merchants about redemption or breakage rates require a reasonable basis**                                                                       | ACCC v Scoopon (2013), A$1M penalty                                                  | **High**   | **Low only if enforced.** Until the pilot produces our own data, no such statement may be made. This is a sales-training control |
| AU-6 | NDB scheme allows 30 days to _assess_, then notify as soon as practicable                                                                                               | Privacy Act s26WH(2), s26WK/WL                                                       | **High**   | Low. Note this is an assessment window, not a notification deadline — plan to Indonesia's 72 hours                               |
| AU-7 | Targeted advertising will require consent under the reform; build to the future rule                                                                                    | Exposure draft, 31 Aug 2026                                                          | Medium     | The draft may change. Building to the stricter reading costs little                                                              |
| AU-8 | ACNC-registered charities are deemed authorised to fundraise in most states                                                                                             | State harmonisation reforms                                                          | **High**   | Low                                                                                                                              |
| AU-9 | **Minimum age 18** — 18 is the general age of contractual capacity, but this is asserted rather than cited, and the Privacy Act reform adds child-protection provisions | Needs a citation                                                                     | Medium     | Confirm alongside ID-12                                                                                                          |

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
- **Re-verified quarterly.** Both regimes are actively changing: GR 33/2026 bites 16 Jan 2027, the Australian reform is mid-passage, Permendag 19/2026 is new.
- **Any change to the product re-opens the affected position.** The register is reviewed at every phase gate, not annually.
- **Counsel review is scheduled, not abandoned** — budget one review of this register before the Australia launch or the first institutional raise, whichever comes first. Reviewing a register is a fraction of the cost of reviewing a business.

## Risk accepted

Proceeding without advisory counsel is a **deliberate, documented decision** by the founder, recorded here so it is a choice rather than an oversight.

**The exposure is concentrated in ID-1 and ID-2** — the position that YourTal Points are not e-money. Every other position is either explicit in published rules or avoided by design. If one thing were to be paid for early, it is a single written opinion on that one question in Indonesia. It is a narrow question, it would be comparatively cheap, and it is the one that could stop the business rather than merely cost it money.
