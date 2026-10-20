import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/**
 * A software passkey for tests: a real P-256 key pair that answers WebAuthn
 * ceremonies the way a platform authenticator does (attestation "none",
 * user present and verified, synced). Responses are built byte for byte from
 * the WebAuthn spec, so the server's real verification code runs on them.
 *
 * `overrides` lets a test break one property (origin, flags, counter,
 * user handle) to prove the server refuses it.
 */
export interface SoftAssertionOverrides {
  readonly origin?: string;
  readonly userVerified?: boolean;
  readonly counter?: number;
  readonly userHandle?: string | null;
  readonly rpId?: string;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16).toString("base64url");
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private userHandle: string | null = null;
  private counter = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  /** Answers `navigator.credentials.create()`. */
  register(options: PublicKeyCredentialCreationOptionsJSON): RegistrationResponseJSON {
    this.userHandle = options.user.id;
    const clientDataJSON = this.clientData("webauthn.create", options.challenge, this.origin);
    const authData = Buffer.concat([
      this.authDataHead(this.rpId, FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT, 0),
      Buffer.alloc(16), // AAGUID: none
      u16(Buffer.from(this.credentialId, "base64url").length),
      Buffer.from(this.credentialId, "base64url"),
      Buffer.from(this.coseKey()),
    ]);
    const attestation = new Map<string, string | Map<string, string> | Uint8Array>();
    attestation.set("fmt", "none");
    attestation.set("attStmt", new Map<string, string>());
    attestation.set("authData", new Uint8Array(authData));
    const attestationObject = isoCBOR.encode(attestation);
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        transports: ["internal", "hybrid"],
      },
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
    };
  }

  /** Answers `navigator.credentials.get()`. */
  assert(
    options: PublicKeyCredentialRequestOptionsJSON,
    overrides: SoftAssertionOverrides = {},
  ): AuthenticationResponseJSON {
    this.counter = overrides.counter ?? this.counter + 1;
    const userVerified = overrides.userVerified ?? true;
    const flags = FLAG_UP | FLAG_BE | FLAG_BS | (userVerified ? FLAG_UV : 0);
    const authData = this.authDataHead(overrides.rpId ?? this.rpId, flags, this.counter);
    const clientDataJSON = this.clientData(
      "webauthn.get",
      options.challenge,
      overrides.origin ?? this.origin,
    );
    const signed = Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]);
    const signature = sign("sha256", signed, this.privateKey);
    const handle = overrides.userHandle === undefined ? this.userHandle : overrides.userHandle;
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
        ...(handle === null ? {} : { userHandle: handle }),
      },
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
    };
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), "utf8");
  }

  private authDataHead(rpId: string, flags: number, counter: number): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([
      createHash("sha256").update(rpId, "utf8").digest(),
      Buffer.from([flags]),
      count,
    ]);
  }

  /** The public key as a COSE_Key map: EC2, ES256, P-256. */
  private coseKey(): Uint8Array {
    const jwk = this.publicKey.export({ format: "jwk" });
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x ?? "", "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y ?? "", "base64url"))],
      ]),
    );
  }
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value);
  return out;
}
