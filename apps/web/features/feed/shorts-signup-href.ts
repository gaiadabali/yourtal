/**
 * Where a visitor's "Sign up to earn" on Shorts goes: the real sign-up page, returning to Shorts afterwards
 * (the page itself reads `returnTo`). Home's teasers point at /onboarding, which a signed-out visitor is
 * bounced from to sign-in first; this goes straight to sign-up.
 */
export const SHORTS_SIGN_UP_HREF = "/register?returnTo=%2Fshorts";
