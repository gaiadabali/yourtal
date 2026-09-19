# YT-0451 session protocol — hold this while you talk to someone

**What this document is not:** a way to tick YT-0451's boxes. Those boxes close when the
sessions have actually been run with real merchants and real users and the findings are
written up — not when a protocol exists. This document only turns "someone must design a
study" into "someone must run it." Nobody should mark YT-0451 done because this file exists.

**Who this is for:** the person in the room (or on the call) with a merchant or a user. It
assumes you have not read the rest of `docs/` and does not require you to. Everything you
need to run a session is below, in the order you will use it.

---

## 0. Before you recruit anyone

- **Ten merchants, fifteen users, in both Australia and Indonesia.** Do not run only
  Indonesia and call it done. Indonesia proves the software works, the merchant mechanics
  hold up, and the fraud model is sound. It **cannot** tell you whether the reward is
  attractive, because a reward that is generous against Jakarta's wage is not automatically
  generous against Sydney's. Reward-attractiveness is an Australia-only result. Skipping the
  Australian sessions doesn't save time on this task, it just means the task didn't happen.
- **Recruit merchants who look like real advertisers, not friends of the founder.** A
  merchant who already trusts the founder will be polite about the console. You want someone
  who would normally say "how much does this cost and why should I bother."
- **Recruit users across the reward-sensitivity range**, not just people who'll try anything
  for a voucher: some who say they never do surveys/rewards apps, some who do them
  constantly. The unprompted-rate question in §3 depends on getting people who actually stop
  to think about value, not just people who click through everything.
- **Do not brief anyone before the session on what you're testing for.** If a participant
  arrives already thinking "they want to know if I'll do this for the money," §3 is void
  before it starts.

---

## 1. What the prototype cannot show — say this out loud when you hit it, never fake it

The build you are demonstrating is a clickable prototype against mock data with no backend.
Tell participants this in plain language at the start ("this is an early mockup, some things
are stubbed in, I'll tell you when we hit one"). When you reach one of these, say so — do not
let a participant believe something worked when it didn't; that produces false reactions you
cannot use.

| What happens                                                                                                                              | What it is not                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Long-form video never actually plays.** Every campaign points at the same shared test stream, and the video segment fetch reliably fails in this build — you will see a loading state that never resolves into playback. | Not a slow connection, not something to retry. It will not start. See the workaround in §4.2.            |
| **The phone verification code is never really sent.** Any 6-digit code (or the one shown on-screen, if the mock displays it) will pass.  | Not a real SMS OTP. Do not let a participant think their phone number was actually used to text them.     |
| **No real money moves anywhere** — not a voucher purchase, not a campaign budget spend, not a merchant invoice.                            | Nothing charges a card or debits an account. Say this if a merchant asks what happens if they click "pay." |
| **Account deletion has no live backend.** The screen shows the real disclosure copy and completes the local confirmation step, but nothing is actually deleted anywhere.            | If a user goes through with it expecting a real deletion, tell them afterward.                            |
| **Several reports panels in the business console are deliberately empty**, e.g. completion-by-chapter, question accuracy, recall score, redemption-by-campaign attribution. This is not missing polish — the underlying data contracts don't yet carry the fields needed to compute these numbers honestly, so the screen says so rather than showing an invented chart. | Do not apologise for these as bugs. If a merchant asks "where's the data," the honest answer is "the platform doesn't have a real answer for that yet, and we'd rather show you that than make one up" — and that answer is itself worth recording as a reaction. |

If something else breaks that isn't on this list, tell the participant plainly, note it in
§5's margin, and move on. Never narrate broken UI as if it worked.

---

## 2. Merchant session script — 10 merchants, business console + redemption portal

**~35–40 minutes. Goals, never instructions.** Never say "click Campaigns" — say what the
merchant wants to know or do, and watch where they go. The moment you name the screen, you
stop testing whether they could find it.

Run in this order:

1. **Orientation (2 min).** "This is an early mockup of a platform that pays your customers
   to watch a video about your business and answer a few questions about it, then gives them
   a voucher to redeem in your shop. I'm going to give you a few things you'd want to do as a
   business owner, and just think out loud as you go — there's no wrong way to click around."
   Read §1's caveats now, before anything else, in your own words.
2. **Task — set up a campaign.** "You want to run a promotion where new customers watch a
   short video about your shop and get a voucher for it. Get as far as you can toward making
   that happen." (Tests: finding the campaign builder, upload/chapter/reward/targeting/budget
   steps, whether the entry-card preview reads as trustworthy — it is the literal contract the
   user sees, so a merchant misreading it here is a copy problem worth catching twice.)
3. **Task — write the questions.** "You want to check that someone actually watched, without
   asking for anything personal." (Tests: question bank authoring, the bank-size explanation,
   the PII-request rejection — does a merchant understand *why* a question got rejected, or
   does it read as the tool being broken?)
4. **Task — check last week's campaign.** "You ran a campaign last week and you want to know
   whether it was worth it — did people actually watch, did they redeem, would you do it
   again." (Tests: Business reports. This is where the empty panels in §1 will surface. Watch
   for whether the merchant reads the empty state as "the product doesn't have this yet" —
   fine — or as "the product is broken" or "they're hiding something from me" — a failure
   signal, note it verbatim.)
5. **Task — redeem a voucher.** Hand them a phone or let them use the merchant redemption
   portal live. "A customer is standing in front of you with a voucher on their phone. Get
   them their discount." (Tests: the redemption portal — code entry or QR, confirm, done. Time
   this. It must be fast and one-handed; note any two-handed or hesitant fumbling explicitly.)
6. **Task — hand off to staff.** "Someone else who works the counter needs to be able to do
   what you just did, without your login." (Tests: device provisioning / PIN unlock framing —
   does the merchant understand this is a shared-device PIN, not a personal account, without
   being told?)
7. **Task — take the phone away.** "That staff member just quit." (Tests: whether the merchant
   finds the revoke control, and whether they trust that it actually worked.)
8. **Thinly-funded campaign reaction — do this in both markets.** Show the merchant a second,
   pre-built campaign draft in the entry-card preview: a 20-minute video carrying a reward
   sized like a loyalty top-up rather than a real voucher (see §4.3 for the exact numbers to
   use). Ask: "If this were your campaign, would you run it at this reward level? Why or why
   not?" Record the reason, not just yes/no — "too cheap for what I'm asking of the customer"
   is a different finding from "seems fine, it's optional."
9. **Wrap-up (open).** "What would stop you from actually paying for this today?" Let them
   talk. Do not defend the product or explain away an objection — write it down.

---

## 3. User session script — 15 users, earn + spend + redeem

**~40–50 minutes. This is the section with the falsification test in it. Read §3.1's ordering
rule before you run a single session — getting the order wrong voids the result for that
participant.**

### 3.1 The ordering rule, and why it is not negotiable

The unprompted-rate question is worthless if anything earlier in the session has mentioned
money, time-value or wages. That includes your own small talk. Before the two rate questions
below have both been asked, do not say or let the participant hear, in any form: *worth it,
worth your time, fair pay, hourly, per hour, per minute, wage, minimum wage, how long did
that take* (you may ask this after the reward question, never before), *paid, salary, gig
work, Uber, survey panel rate*. You may talk about the reward itself — points, the voucher,
what they earned — because that is the product's own vocabulary, not a wage frame. What you
must never do is frame time and money together before they've had the chance to do it
themselves.

### 3.2 Running order

1. **Orientation (2 min).** Read §1's caveats in your own words. "I'm going to give you a few
   things people use this app for. Just talk out loud."
2. **Task — sign up.** "You've heard a friend earns vouchers on this app. Get yourself set up
   to try it." (Onboarding, phone verification — remember the OTP caveat from §1, and never
   call it "your security code" or otherwise imply it protects anything.)
3. **Task — find something quick to do.** "You've got two minutes before your bus. See what
   you can do with them." (Quick feed. Watch for whether they find it via the tab bar
   unprompted, and whether the swipe-and-snap feel reads as a real feed or a broken one.)
4. **→ Ask the Quick rate question now (see §3.3), before anything else.**
5. **Task — find something to properly sit down and do.** "You've got twenty minutes and
   nothing else to do. See what's worth spending it on." (Long-form entry card → the
   video-doesn't-play limitation from §1 will hit here — use the workaround in §4.2 — →
   checkpoint quiz → result screen.)
6. **→ Ask the long-form rate question now (see §3.3), before anything else — including
   before the thinly-funded variant in §4.3.**
7. **Thinly-funded campaign reaction — do this in both markets (see §4.3 for the exact setup).**
   Present the deliberately thin long-form campaign and let them start it. Ask what they think
   partway through, and ask again if they finish or quit.
8. **Task — spend it.** "You've got some points now — see what you'd get with them." (Store
   browse → offer detail → burn flow with price lock. Note any hesitation at the price-lock
   countdown or the holdback explanation.)
9. **Task — use a voucher in a shop.** "Show me what you'd do at the counter to actually use
   this." (Voucher detail, offline QR — you don't need a real merchant device present; ask
   them to narrate what they'd hand over.)
10. **Task — leave.** "Suppose you wanted to stop using this and get rid of your account. Show
    me how far you'd get." (Me → account deletion — remember the §1 caveat: there is no live
    backend, tell them once they've gone through the disclosure.)
11. **Wrap-up (open).** "What would make you delete this app after a week?" Let them talk.

### 3.3 The exact wording — say it exactly like this

Ask each of these **once**, immediately after the relevant task, before moving on to
anything else, and **before you have said any of the forbidden words in §3.1**.

> **After Quick:** *"Thinking about what you just did — if you were setting the reward for
> something like that from scratch, what do you think it should pay?"*
>
> **After long-form + the quiz:** *"Thinking about what you just did — if you were setting
> the reward for something like that from scratch, what do you think it should pay?"*

Do not add "per hour," "per minute," or any unit. Let them supply the frame. If their first
answer is a bare number with no frame ("like five dollars" / "Rp20,000"), ask exactly one
neutral follow-up and then stop: *"How did you land on that?"* Do not ask "was that based on
time" — that supplies the frame you are trying not to supply.

### 3.4 Coding the answer — so two facilitators code it the same way

Write the participant's answer down verbatim in §5, then mark it as one of the two categories
below. When in doubt, write the quote and mark it "unclear" rather than force a category —
don't adjudicate live.

**Reached for a rate (the failure signal for §2.6 of `23-critique.md`):**
- Names or implies a per-time unit at all — "$15 an hour," "a couple bucks a minute,"
  "like Uber money"
- Divides the money by the time themselves, even without naming a unit — "for twenty
  minutes, maybe ten bucks" said while visibly doing the division, or "that's not much for
  the time it took"
- Compares to a wage, gig-work payout, or paid-survey rate — "less than minimum wage,"
  "survey sites pay more than that," "that's below what I'd expect for actual work"
- Says anything containing the words "worth my time" unprompted

**Stayed in the reward frame (the pass signal):**
- Values it against the voucher or the product itself — "seems like a decent coffee,"
  "that's a good deal for a $30 voucher"
- Treats it as a bonus rather than a transaction — "any voucher is nice, I wasn't expecting
  anything"
- Answers in terms of the item redeemed, not effort — "I'd want something I'd actually use"
- Compares to a loyalty scheme, not a job — "like Flybuys points"

Record the raw quote either way. The category is your call at the time; the quote is what
someone else checks it against later.

---

## 4. The two things that are easy to get wrong

### 4.1 Both markets, every time

Run the **entire** protocol — merchant script and user script, including the thin-campaign
test — in Australia and in Indonesia. Do not run one market's sessions and extrapolate.
Indonesia's result on the rate question tells you the mechanic itself doesn't inherently read
as work when the reward clears the local bar by a wide margin — useful, but it says nothing
about whether it clears the bar in Australia, because the reward-to-income ratio is not
comparable between the two markets. The thin-campaign test in §4.3 is not an Australia
problem either — run it in both, because reward funding is partner-controlled and variable in
both markets today.

### 4.2 The long-form video does not actually play — how to run the task anyway

Do not pretend it works. Do not narrate fake progress. When the participant hits the stalled
loading state:

1. Say plainly: "This part doesn't actually play in this build — here's what you'd be looking
   at." Show them the entry card again (duration, reward, data cost, question count — this is
   the actual artefact people judge, whether the video plays or not) and, if reachable in this
   build, the chapter-marker/progress layout and the checkpoint quiz screen on their own,
   without sitting through fake elapsed time.
2. Ask them to evaluate based on **what they were promised on the entry card** plus **the quiz
   they actually did** — that is genuinely testable even though playback is not. Say
   explicitly: "Imagine you'd just watched all of that." Do not shorten the quiz or skip it —
   the quiz is real and is exactly where the research-panel comparison in §2.6 lives.
3. Note in §5 that this participant's long-form reaction is based on the entry card + quiz,
   not real elapsed viewing time, so it can be weighed accordingly when you read the results
   back. This is a genuine limitation of this round, not something to solve mid-session.

### 4.3 The thinly-funded campaign — build this once per market, use it in both scripts

Rewards are funded by whichever partner is running the campaign, so nothing stops a long-form
campaign (20 minutes, checkpoint quiz, full comprehension gate) from carrying a reward sized
for a 15–60 second Quick task instead. That combination — research-panel effort, loyalty-sized
pay — is the worst case in the model, and it is not specific to either market.

**Build one fixture campaign per market before sessions start:**

| Market | Long-form campaign, well-funded (for the main task in §3.2 step 5) | Long-form campaign, thinly-funded (for §2 step 8 / §3.2 step 7) |
| --- | --- | --- |
| Indonesia | 20 min, IDR 50,000 voucher (the illustrative figure in `01-strategy-and-economics.md` §2.5) | 20 min, an IDR 5,000–10,000 voucher or points-only reward — sized like a single Quick campaign, not a sit-down one |
| Australia | 20 min, an AUD voucher priced against the paid-survey-panel benchmark in `23-critique.md` §2.6 (a few dollars for 15–20 minutes, not a wage) | 20 min, an AUD 1–2 voucher or points-only reward — sized like a single Quick campaign |

**What a fail looks like, for this test specifically** (record separately from §3.3's coding):
- Explicit disengagement: quits before the quiz, skips ahead, or says some version of "not
  worth finishing"
- Explicit insult framing: "this feels like they don't respect my time," "why would I do all
  that for this"
- The participant reaches for a rate (§3.3's rubric) *specifically triggered by the mismatch*
  between effort and reward — e.g. they didn't do this for the well-funded campaign but do it
  here, unprompted, comparing the two: "wait, that's way less than the last one for the same
  amount of work"
- For merchants: refusing to run it even hypothetically, or "I'd only do this if the reward
  matched the effort" stated as a hard rule, not a preference

A muted-but-tolerant reaction ("meh, I'd probably still finish it, just wouldn't expect much")
is not a fail on its own — it is exactly the ambiguous middle this test exists to find, and
it should be written up as such, not rounded to pass or fail.

---

## 5. Recording template — fill this in live, per participant, per task

Do not wait until after the session to write this up. Three columns are separated on purpose
because they mean different things: **hesitation** is a discoverability problem (they didn't
know where to look), **misreading** is a copy problem (they looked in the right place and got
the wrong idea), and a **request** is a scope signal (they wanted something the product
doesn't do at all). Mixing these together loses the information.

```
Participant #: __   Market: AU / ID   Role: Merchant / User   Date:

Task: _______________________________________________

  Hesitated? (where, how long, what they said while stuck)
  ________________________________________________________

  Misread? (what they thought was true that wasn't, and what
  on screen led them there)
  ________________________________________________________

  Asked for? (a feature, an explanation, a control that isn't
  there — quote it)
  ________________________________________________________

  Hit a prototype limitation from §1? Which one, and how did
  they react to being told?
  ________________________________________________________

[repeat the block above once per task in §2 or §3]

--- Rate question (users only, ask exactly per §3.3) ---

  Quick — verbatim answer:
  ________________________________________________________
  Coded as: REACHED FOR A RATE / STAYED IN REWARD FRAME / UNCLEAR

  Long-form — verbatim answer:
  ________________________________________________________
  Coded as: REACHED FOR A RATE / STAYED IN REWARD FRAME / UNCLEAR

--- Thin-campaign reaction (§4.3) ---

  Reaction (verbatim where possible):
  ________________________________________________________
  Fail criteria met? Which one(s):
  ________________________________________________________

--- Wrap-up ---

  What would make them stop using it / stop paying for it:
  ________________________________________________________
```

---

## 6. Pass/fail criteria — written down before any session runs

State these now, not after you've seen the results. A study that cannot fail tells the
founder nothing.

**The product does not work if any of these hold, once all 25 sessions across both markets
are in:**

1. **Rate-frame majority in Australian long-form.** If more than half of the 15 Australian
   users reach for a rate (§3.3's rubric) on the long-form question, the format has left the
   loyalty frame regardless of intent, and long-form needs a redesign — shorter duration,
   larger reward, or a different framing — before Australian launch. (Quick reaching for a
   rate would be a separate, smaller problem; the model does not predict it and it should be
   reported even if rare.)
2. **Thin-campaign fail majority, in either market.** If more than half of thin-campaign
   reactions in a market meet a fail criterion from §4.3, thinly-funded long-form campaigns
   are not viable as designed in that market, and the platform needs either a reward floor
   below which long-form cannot be offered, or a duration cap tied to funding level. This
   holding in Indonesia is just as disqualifying as it holding in Australia — it is not an
   Australia-specific finding either way.
3. **Merchant second-campaign refusal.** If more than half of the 10 merchants say outright
   they would not run a second campaign at the reward levels shown (not "would need to think
   about it" — an actual no), that is the Groupon/Plenti failure mode from `21-failed-
   analogues.md` showing up before a line of backend exists, and it should stop the Phase 1
   scope decision cold rather than be noted and carried forward.
4. **Redemption-portal task failure.** If more than 2 of the 10 merchants cannot complete a
   redemption in under 30 seconds without help, "mobile-first, two taps" (YT-0445) has not
   actually been achieved and this blocks calling the redemption flow pilot-ready — feed this
   straight back to that ticket's owner, don't just log it here.
5. **Confusion about what is real.** If any participant, after the session, still believes
   something from §1's list actually happened (a real SMS was sent, a real account was
   deleted, real money moved), that is a session-conduct failure, not a product finding —
   note which caveat was missed and fix the script before the next session, not after all 25.

**What a pass looks like:** none of the above, plus a body of hesitation/misreading/request
notes specific enough that a designer could act on them without sitting in on the sessions.
"People generally liked it" is not a usable outcome either way — if every note is that vague,
the sessions were not run adversarially enough, independent of what the founder wants to
hear.

**This feeds `docs/tasks/phase-minus-1-pilot.md`'s own gate directly.** That gate is ≥40%
completion on a 15-minute video and one merchant who paid and wants to repeat — a much lower
bar, tested with real traffic and real money instead of a facilitator in the room. A YT-0451
finding of "reached for a rate" or "thin campaign fails" does not block the pilot from
running, but it tells you which risk the pilot's low completion rate (if it comes in low)
is more likely explained by, before you spend the pilot's traffic budget finding out the hard
way.
