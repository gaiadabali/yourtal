import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadClients } from "./client-keys";
import { CLIENTS, clientsFor, isSignInClient } from "./clients";

const DIR = "/opt/yourtal/secrets/oidc/clients";

function files(contents: Record<string, string>) {
  return {
    exists: (file: string) => file in contents,
    read: (file: string) => contents[file] ?? "",
  };
}

function publicJwks(): string {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1" }] });
}

const ALL_FILES = {
  [path.join(DIR, "snapapp-staging-web.jwks.json")]: publicJwks(),
  [path.join(DIR, "snapapp-staging-server.jwks.json")]: publicJwks(),
  [path.join(DIR, "ftr-staging-web.secret")]: `${"s".repeat(40)}\n`,
};

describe("the client registry (docs/26 §1.9)", () => {
  it("registers the staging clients of the table, and nothing in production yet", () => {
    expect(clientsFor("staging").map((client) => client.clientId)).toEqual([
      "snapapp-staging-web",
      "snapapp-staging-mobile",
      "snapapp-staging-server",
      "ftr-staging-web",
    ]);
    // ftr-web waits for real people (docs/26 §6 Q1); SnapApp's production clients for its domain.
    expect(clientsFor("production")).toEqual([]);
  });

  it("gives every sign-in client one exact redirect URI: https for websites, reverse-DNS for the phone", () => {
    for (const client of CLIENTS.filter(isSignInClient)) {
      const uri = new URL(client.redirectUri);
      expect(uri.hash).toBe("");
      expect(uri.search).toBe("");
      expect(client.redirectUri).not.toMatch(/localhost|127\.0\.0\.1|\*/);
      if (client.kind === "web") {
        expect(uri.protocol).toBe("https:");
        expect(uri.host).toBe(client.returnHost);
      } else {
        expect(uri.protocol).toBe("au.com.snapapps.app:");
      }
    }
  });

  it("lets only the phone app authenticate with none", () => {
    expect(
      CLIENTS.filter((client) => client.auth === "none").map((client) => client.clientId),
    ).toEqual(["snapapp-staging-mobile"]);
  });

  it("puts SnapApp's three clients in one sector, and FTR in its own", () => {
    const sectors = new Map(CLIENTS.map((client) => [client.clientId, client.sector]));
    expect(sectors.get("snapapp-staging-mobile")).toBe(sectors.get("snapapp-staging-web"));
    expect(sectors.get("snapapp-staging-server")).toBe(sectors.get("snapapp-staging-web"));
    expect(sectors.get("ftr-staging-web")).not.toBe(sectors.get("snapapp-staging-web"));
    expect(sectors.get("ftr-web")).not.toBe(sectors.get("ftr-staging-web"));
  });

  it("refuses teens at FTR and takes Australia only there; SnapApp is invite-only for teens", () => {
    for (const client of CLIENTS.filter(isSignInClient)) {
      if (client.sector.startsWith("ftr")) {
        expect(client.teens).toBe("refuse");
        expect(client.regions).toEqual(["AU"]);
      } else {
        expect(client.teens).toBe("invite_only");
        expect(client.regions).toEqual(["AU", "ID"]);
      }
    }
  });

  it("allows sign-in clients the four sign-in scopes, and teen_invites to SnapApp's server only", () => {
    for (const client of CLIENTS) {
      expect(client.allowedScopes).toEqual(
        client.kind === "machine" ? ["teen_invites"] : ["openid", "email", "profile", "account"],
      );
    }
  });
});

describe("client credentials from the secrets directory", () => {
  it("registers each client with its key or secret, read from the directory", () => {
    const loaded = loadClients(clientsFor("staging"), DIR, files(ALL_FILES));
    expect(loaded.missing).toEqual([]);
    const byId = new Map(loaded.metadata.map((metadata) => [metadata.client_id, metadata]));
    expect(byId.get("snapapp-staging-web")?.jwks?.keys).toHaveLength(1);
    expect(byId.get("ftr-staging-web")?.client_secret).toBe("s".repeat(40));
    expect(byId.get("snapapp-staging-mobile")?.token_endpoint_auth_method).toBe("none");
    expect(byId.get("snapapp-staging-server")?.grant_types).toEqual(["client_credentials"]);
    expect(byId.get("snapapp-staging-web")?.grant_types).toEqual(["authorization_code"]);
  });

  it("leaves out a client whose file is missing, naming the file", () => {
    const loaded = loadClients(clientsFor("staging"), DIR, files({}));
    expect(loaded.registered.map((client) => client.clientId)).toEqual(["snapapp-staging-mobile"]);
    expect(loaded.missing.map((entry) => entry.clientId)).toEqual([
      "snapapp-staging-web",
      "snapapp-staging-server",
      "ftr-staging-web",
    ]);
  });

  it("refuses a public-key file that holds a private key", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const leaked = JSON.stringify({
      keys: [{ ...privateKey.export({ format: "jwk" }), kid: "k" }],
    });
    expect(() =>
      loadClients(
        clientsFor("staging"),
        DIR,
        files({ ...ALL_FILES, [path.join(DIR, "snapapp-staging-web.jwks.json")]: leaked }),
      ),
    ).toThrow(/private key material/);
  });

  it("refuses a short client secret", () => {
    expect(() =>
      loadClients(
        clientsFor("staging"),
        DIR,
        files({ ...ALL_FILES, [path.join(DIR, "ftr-staging-web.secret")]: "short" }),
      ),
    ).toThrow(/32 characters/);
  });
});
