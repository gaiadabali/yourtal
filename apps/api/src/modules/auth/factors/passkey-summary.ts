import type { PasskeySummary } from "@yourtal/contracts/identity/sign-in-methods";
import type { StoredPasskey } from "../persistence/passkey.repository";

/** What the person sees of a passkey. Never the public key or the counter. */
export function passkeySummary(passkey: StoredPasskey): PasskeySummary {
  return {
    id: passkey.credentialId,
    name: passkey.name,
    createdAt: passkey.createdAt.toISOString(),
    lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
    synced: passkey.backedUp,
  };
}
