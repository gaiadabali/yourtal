import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";

/** A details object as `GET /api/connect/{uid}` answers it; each test overrides what it is about. */
export function details(overrides: Partial<InteractionDetails> = {}): InteractionDetails {
  return {
    uid: "uid_123-abc",
    screen: "consent",
    client: {
      clientId: "snapapp-web",
      name: "SnapApp",
      operator: "Gaiada Pty Ltd",
      externalOperator: false,
      privacyUrl: "https://snap-apps.gaiada.com/privacy",
      termsUrl: "https://snap-apps.gaiada.com/terms",
      returnHost: "snap-apps.gaiada.com",
    },
    account: { name: "Ana", email: "ana@example.com" },
    sharing: { claims: ["name", "email", "age_band", "region"], ageBand: "adult", region: "AU" },
    refusal: null,
    uiLocales: [],
    ...overrides,
  };
}
