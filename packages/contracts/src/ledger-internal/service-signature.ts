import { createHash, createHmac, randomUUID } from "node:crypto";

/**
 * The `X-YourTal-Service-Signature` header for a loopback call to the ledger
 * (`services/ledger/internal/serviceauth`): HMAC-SHA256 over timestamp,
 * caller, nonce, method, path with query and the body's base64 SHA-256,
 * newline-joined. Shared by apps/api and apps/worker; server-side only.
 */
export const SERVICE_SIGNATURE_HEADER = "x-yourtal-service-signature";

/** The services the ledger lets sign. */
export type ServiceCaller = "api" | "worker";

export interface ServiceSignatureInput {
  readonly secret: string;
  readonly caller: ServiceCaller;
  readonly method: string;
  readonly pathAndQuery: string;
  readonly body: string;
  /** Seconds since the epoch; defaults to now. */
  readonly unixSeconds?: number;
  /** Defaults to a random UUID; the ledger refuses a repeat. */
  readonly nonce?: string;
}

export function signServiceRequest(input: ServiceSignatureInput): string {
  const t = input.unixSeconds ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? randomUUID();
  const digest = createHash("sha256").update(input.body).digest("base64");
  const mac = createHmac("sha256", input.secret)
    .update(
      [String(t), input.caller, nonce, input.method.toUpperCase(), input.pathAndQuery, digest].join(
        "\n",
      ),
    )
    .digest("hex");
  return `t=${String(t)},c=${input.caller},n=${nonce},v1=${mac}`;
}
