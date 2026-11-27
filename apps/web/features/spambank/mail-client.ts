import { createMailClient } from "@yourtal/mail-engine";
import type { MailClient } from "@yourtal/mail-engine";
import { sessionFrom } from "./mail-session";
import { mintMailSessionAction } from "./spambank-actions";

/**
 * The one mail client of a browser tab. The nav badge (in the shell, loaded on its own) and the
 * mail screens both use it, so there is one token, one folders store and one live stream however
 * many places show mail. The engine fetches nothing until a hook subscribes. Only the lazily loaded
 * mail chunks import this file, so the engine stays out of every other page's first load.
 */
let shared: MailClient | null = null;

export function sharedMailClient(): MailClient {
  shared ??= createMailClient({ getSession: () => sessionFrom(mintMailSessionAction) });
  return shared;
}

/** The lab preview and tests swap in the in-memory client; `null` goes back to the real one. */
export function setSharedMailClient(client: MailClient | null): void {
  shared = client;
}
