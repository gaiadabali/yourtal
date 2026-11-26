/**
 * How the service logs in to a mailbox (spambank/BUILD.md §4.3, B3). The derivation itself lives in
 * `@yourtal/drivers`, because the worker logs in too and two copies would drift; it is re-exported
 * here, where the API's callers (the proxy, provisioning) look for it.
 */
export { addressFor, derivePassword, loginFor } from "@yourtal/drivers/spambank";
