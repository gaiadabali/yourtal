import type { OnboardingCopy } from "./onboarding-copy";

/**
 * English copy for the `en-AU` locale (a user who picks Australia at
 * registration — docs/tasks/phase-u-ui.md YT-0430's region criterion).
 *
 * The `verify.otpDisclaimer` and `essential.body` strings are deliberately
 * blunt about what a one-time code does and does not prove — per
 * docs/23-critique.md section 1.0, an OTP is a friction/de-duplication
 * check (Indonesian SIMs run ~9 per NIK, OTP rental is cents), never
 * identity proof, and copy that called it "verified and secure" would be
 * false. See `phone-verification-flow.tsx` for where these render.
 */
export const enAuOnboardingCopy: OnboardingCopy = {
  common: {
    back: "Back",
    stepPrefix: "Step",
    stepJoiner: "of",
  },
  consent: {
    heading: "Before we continue",
    intro:
      "We ask for a few separate permissions, not one blanket agreement. Each one does exactly what it says below, nothing more.",
    essential: {
      title: "Create my account and verify my phone",
      body: "We collect your phone number to create your account and confirm you're a real, unique person signing up once. A one-time code does not prove your identity — only that this number hasn't been used to register before. Required to use YourTal.",
    },
    personalize: {
      title: "Personalise which campaigns I see",
      body: "We use the interests you choose next to decide which earning campaigns to show you first. Leave this off and you'll still see the full board — just not sorted for you.",
    },
    marketing: {
      title: "Send me marketing messages",
      body: "We may message you by SMS or WhatsApp about new campaigns, rewards or promotions. Off by default. Change it anytime in Me → Settings.",
    },
    requiredHint: "required to continue",
    continueLabel: "Continue",
  },
  verify: {
    phoneHeading: "What's your number?",
    phoneIntro: "We'll text you a one-time code to confirm it's really you signing up.",
    phoneLabel: "Mobile number",
    phoneHelp: "Standard message rates may apply.",
    sendCode: "Send code",
    sending: "Sending code…",
    codeHeading: "Enter the code",
    codeSentPrefix: "We sent a 6-digit code to",
    codeLabel: "6-digit code",
    verifyCta: "Verify",
    verifying: "Checking…",
    wrongCode: "That code doesn't match. Check the digits and try again.",
    resend: "Resend code",
    resendCooldownPrefix: "You can resend in",
    resendCooldownSuffix: "s",
    wrongNumber: "Wrong number? Edit it",
    rateLimitedHeading: "Too many attempts",
    rateLimitedBody: "For your security, we've paused new codes for this number.",
    rateLimitedRetryPrefix: "You can try again at",
    verified: "Number confirmed",
    demoCodeHint: "Prototype mode: no SMS is actually sent. Use code 123456.",
    otpDisclaimer:
      "A code proves this number hasn't signed up before — it doesn't verify who you are.",
  },
  interests: {
    heading: "What are you into?",
    intro:
      "Pick a few so we can put the best campaigns first. You can change these anytime in Me → Settings.",
    continueLabel: "Continue",
    skipLabel: "Skip for now",
    selectedSuffix: "selected",
  },
  done: {
    heading: "You're in",
    bodyIntro: "Your account is set up for",
    currencyPrefix: "Prices and rewards will show in",
    cta: "Start earning",
    exampleRewardLabel: "Example reward",
  },
};
