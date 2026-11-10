import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import {
  EVENT_RECEIVERS,
  receiversFor,
  sectorsWithoutReceiver,
} from "@yourtal/contracts/oidc/event-receivers";
import { describe, expect, it } from "vitest";
import { loadClients } from "./client-keys";
import { CLIENTS, TRANSFER_ROUTES, clientsFor, isSignInClient, transferRoutesFor } from "./clients";

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
  [path.join(DIR, "ftr-web.secret")]: `${"s".repeat(40)}\n`,
};

describe("the client registry (docs/26 §1.9)", () => {
  it("registers the staging clients of the table, and nothing in production yet", () => {
    expect(clientsFor("staging").map((client) => client.clientId)).toEqual([
      "snapapp-staging-web",
      "snapapp-staging-mobile",
      "snapapp-staging-server",
      "ftr-web",
    ]);
    // SnapApp's production clients wait for its production domain.
    expect(clientsFor("production")).toEqual([]);
  });

  it("gives every sign-in client exact redirect URIs: https for websites, reverse-DNS or the App Link for the phone", () => {
    for (const client of CLIENTS.filter(isSignInClient)) {
      for (const redirectUri of client.redirectUris) {
        const uri = new URL(redirectUri);
        expect(uri.hash).toBe("");
        expect(uri.search).toBe("");
        expect(redirectUri).not.toMatch(/localhost|127\.0\.0\.1|\*/);
        if (client.kind === "web") {
          expect(uri.protocol).toBe("https:");
          expect(uri.host).toBe(client.returnHost);
        } else if (uri.protocol === "https:") {
          expect(uri.host).toBe(client.returnHost);
        } else {
          expect(uri.protocol).toBe("au.com.snapapps.app:");
        }
      }
    }
  });

  it("gives the phone app its scheme and its App Link (3.3.e), and every other client exactly one", () => {
    const uris = new Map(
      CLIENTS.filter(isSignInClient).map((client) => [client.clientId, client.redirectUris]),
    );
    expect(uris.get("snapapp-staging-mobile")).toEqual([
      "au.com.snapapps.app:/oauth/yourtal",
      "https://snap-apps.gaiada.com/oauth/yourtal",
    ]);
    for (const [clientId, list] of uris) {
      if (clientId !== "snapapp-staging-mobile") expect(list, clientId).toHaveLength(1);
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
    expect(sectors.get("ftr-web")).not.toBe(sectors.get("snapapp-staging-web"));
    expect(sectors.get("ftr-web")).toBe("ftr");
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

  it("names each app's operator from the settings (F125), brand names by default", () => {
    const named = clientsFor("staging", { snapapp: "SnapApp Pty Ltd", ftr: "FTR Pty Ltd" });
    expect(named.map((client) => client.operator)).toEqual([
      "SnapApp Pty Ltd",
      "SnapApp Pty Ltd",
      "SnapApp Pty Ltd",
      "FTR Pty Ltd",
    ]);
    expect(clientsFor("staging").map((client) => client.operator)).toEqual([
      "SnapApp",
      "SnapApp",
      "SnapApp",
      "Free Tax Returns",
    ]);
    expect(named.find((client) => client.clientId === "ftr-web")?.externalOperator).toBe(true);
  });

  it("allows sign-in clients the four sign-in scopes, and the client APIs to machine clients only", () => {
    for (const client of CLIENTS) {
      if (client.kind === "machine") {
        expect(["teen_invites", "app_transfers"]).toEqual(
          expect.arrayContaining([...client.allowedScopes]),
        );
      } else {
        expect(client.allowedScopes).toEqual(["openid", "email", "profile", "account"]);
      }
    }
    expect(
      CLIENTS.find((client) => client.clientId === "snapapp-staging-server")?.allowedScopes,
    ).toEqual(["teen_invites", "app_transfers"]);
  });
});

describe("the transfer routes (docs/30 §5)", () => {
  it("send to a sign-in client, from a sector with a server client, in that client's environments", () => {
    for (const route of TRANSFER_ROUTES) {
      const to = CLIENTS.find((client) => client.clientId === route.toClientId);
      expect(to !== undefined && isSignInClient(to)).toBe(true);
      expect(to?.app).toBe(route.to);
      for (const environment of route.environments) expect(to?.environments).toContain(environment);
      expect(
        CLIENTS.some((client) => client.kind === "machine" && client.sector === route.fromSector),
      ).toBe(true);
      for (const region of route.regions) {
        expect(to !== undefined && isSignInClient(to) && to.regions.includes(region)).toBe(true);
      }
    }
  });

  it("SnapApp to FTR, AU only, dev and staging only, and only while FTR is registered", () => {
    expect(TRANSFER_ROUTES).toEqual([
      {
        kind: "deduction-bundle-v1",
        fromSector: "snapapp-staging",
        to: "ftr",
        toClientId: "ftr-web",
        regions: ["AU"],
        environments: ["dev", "staging"],
      },
    ]);
    expect(transferRoutesFor("production", CLIENTS)).toEqual([]);
    expect(transferRoutesFor("staging", CLIENTS)).toHaveLength(1);
    const withoutFtr = CLIENTS.filter((client) => client.clientId !== "ftr-web");
    expect(transferRoutesFor("staging", withoutFtr)).toEqual([]);
  });
});

describe("the event receivers (docs/29 §5)", () => {
  it("has a receiver for every sector a client is registered in, in every environment", () => {
    expect(sectorsWithoutReceiver(CLIENTS)).toEqual([]);
  });

  it("fails for a sector that has a client but no receiver, or none in that environment", () => {
    expect(sectorsWithoutReceiver(CLIENTS, EVENT_RECEIVERS.slice(1))).toEqual([
      "snapapp-staging@dev",
      "snapapp-staging@staging",
    ]);
    const ftr = EVENT_RECEIVERS.filter((receiver) => receiver.sector === "ftr");
    expect(sectorsWithoutReceiver(CLIENTS, [{ ...ftr[0]!, environments: ["dev"] }])).toContain(
      "ftr@staging",
    );
  });

  it("names a receiving client that exists, in the receiver's sector and environments", () => {
    for (const receiver of EVENT_RECEIVERS) {
      const client = CLIENTS.find((one) => one.clientId === receiver.clientId);
      expect(client?.sector).toBe(receiver.sector);
      expect(client?.eventsEndpoint).toBe(receiver.endpoint);
      for (const environment of receiver.environments) {
        expect(client?.environments).toContain(environment);
      }
    }
    // One receiver per sector: oidc.forget_subject refuses a list with two.
    const sectors = EVENT_RECEIVERS.map((receiver) => receiver.sector);
    expect(new Set(sectors).size).toBe(sectors.length);
  });

  it("is empty in production, where no client is registered yet", () => {
    expect(receiversFor("production")).toEqual([]);
    expect(receiversFor("staging").map((receiver) => receiver.sector)).toEqual([
      "snapapp-staging",
      "ftr",
    ]);
  });
});

describe("client credentials from the secrets directory", () => {
  it("registers each client with its key or secret, read from the directory", () => {
    const loaded = loadClients(clientsFor("staging"), DIR, files(ALL_FILES));
    expect(loaded.missing).toEqual([]);
    const byId = new Map(loaded.metadata.map((metadata) => [metadata.client_id, metadata]));
    expect(byId.get("snapapp-staging-web")?.jwks?.keys).toHaveLength(1);
    expect(byId.get("ftr-web")?.client_secret).toBe("s".repeat(40));
    expect(byId.get("snapapp-staging-mobile")?.token_endpoint_auth_method).toBe("none");
    expect(byId.get("snapapp-staging-mobile")?.redirect_uris).toEqual([
      "au.com.snapapps.app:/oauth/yourtal",
      "https://snap-apps.gaiada.com/oauth/yourtal",
    ]);
    expect(byId.get("ftr-web")?.redirect_uris).toEqual([
      "https://freetaxreturns.com.au/api/auth/oauth2/callback/yourtal",
    ]);
    // Two redirect hosts need a (never fetched) sector URI; one-URI clients stay as they were.
    expect(byId.get("snapapp-staging-mobile")?.sector_identifier_uri).toBeDefined();
    expect(byId.get("snapapp-staging-web")?.sector_identifier_uri).toBeUndefined();
    expect(byId.get("snapapp-staging-server")?.grant_types).toEqual(["client_credentials"]);
    expect(byId.get("snapapp-staging-web")?.grant_types).toEqual(["authorization_code"]);
  });

  it("leaves out a client whose file is missing, naming the file", () => {
    const loaded = loadClients(clientsFor("staging"), DIR, files({}));
    expect(loaded.registered.map((client) => client.clientId)).toEqual(["snapapp-staging-mobile"]);
    expect(loaded.missing.map((entry) => entry.clientId)).toEqual([
      "snapapp-staging-web",
      "snapapp-staging-server",
      "ftr-web",
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
        files({ ...ALL_FILES, [path.join(DIR, "ftr-web.secret")]: "short" }),
      ),
    ).toThrow(/32 characters/);
  });
});
