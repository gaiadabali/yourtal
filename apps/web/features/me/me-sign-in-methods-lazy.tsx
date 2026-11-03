"use client";

import dynamic from "next/dynamic";

// Below the fold on /me: split out of the first load, which they pushed over the 200 KB gate.
// Must live in a Client Component; a Server Component's dynamic import is not code-split.
export const MePasskeysSection = dynamic(() =>
  import("./me-passkeys-section").then((m) => m.MePasskeysSection),
);

export const MeAuthenticatorSection = dynamic(() =>
  import("./me-authenticator-section").then((m) => m.MeAuthenticatorSection),
);
