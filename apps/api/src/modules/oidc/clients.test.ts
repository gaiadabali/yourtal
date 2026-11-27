import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import {
  EVENT_RECEIVERS,
  receiversFor,
  sectorsWithoutReceiver,
} from "@yourtal/contracts/oidc/event-receivers";
import { describe, expect, it } from "vitest";
import { loadClients } from "./client-keys";
import {
  CLIENTS,
  TRANSFER_ROUTES,
  clientsFor,
  isSignInClient,
  returnHostFor,
  transferRoutesFor,
} from "./clients";

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
  [path.join(DIR, "ftr-server.jwks.json")]: publicJwks(),
  [path.join(DIR, "god-dashboard.jwks.json")]: publicJwks(),
};

describe("the client registry (docs/26 §1.9)", () => {
  it("registers the staging clients of the table, and nothing in production yet", () => {
    expect(clientsFor("staging").map((client) => client.clientId)).toEqual([
      "snapapp-staging-web",
      "snapapp-staging-mobile",
      "snapapp-staging-server",
      "ftr-web",
      "ftr-server",
      "god-dashboard",
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
          // SnapApps' website is on two hosts while the 2026-11-27 move settles; every other web client has one.
          expect([client.returnHost, "snapapp.gaiada.com"]).toContain(uri.host);
        } else if (uri.protocol === "https:") {
          // The App Link on the app's own host, or the phone app's browser build (PWA).
          expect([
            client.returnHost,
            "snapapp.gaiada.com", // the App Link host of APKs before 2026-11-27; stays registered
            "app.snapapps.gaiada.com",
            "snapapp.app.gaiada.com",
          ]).toContain(uri.host);
        } else {
          expect(uri.protocol).toBe("au.com.snapapps.app:");
        }
      }
    }
  });

  it("gives the phone app its scheme, its App Link (3.3.e) and its PWA page, and every other client exactly one", () => {
    const uris = new Map(
      CLIENTS.filter(isSignInClient).map((client) => [client.clientId, client.redirectUris]),
    );
    expect(uris.get("snapapp-staging-mobile")).toEqual([
      "au.com.snapapps.app:/oauth/yourtal",
      "https://snapapps.gaiada.com/oauth/yourtal",
      "https://snapapp.gaiada.com/oauth/yourtal",
      "https://app.snapapps.gaiada.com/oauth/yourtal",
      "https://snapapp.app.gaiada.com/oauth/yourtal",
    ]);
    for (const [clientId, list] of uris) {
      // SnapApps' website has two while its host move settles (the test below pins them).
      if (clientId === "snapapp-staging-web") expect(list, clientId).toHaveLength(2);
      else if (clientId !== "snapapp-staging-mobile") expect(list, clientId).toHaveLength(1);
    }
  });

  it("registers SnapApps' website on its new host and keeps the old one, so a switch of WEB_PUBLIC_URL cannot lock people out", () => {
    const web = CLIENTS.filter(isSignInClient).find((c) => c.clientId === "snapapp-staging-web");
    expect(web?.redirectUris).toEqual([
      "https://snapapps.gaiada.com/auth/yourtal/callback",
      "https://snapapp.gaiada.com/auth/yourtal/callback",
    ]);
    expect(web?.returnHost).toBe("snapapps.gaiada.com");
    expect(web?.privacyUrl).toBe("https://snapapps.gaiada.com/legal/privacy");
    expect(web?.termsUrl).toBe("https://snapapps.gaiada.com/legal/terms");
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
      // The GOD dashboard has its own test below.
      if (client.app === "god") continue;
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
    const named = clientsFor("staging", {
      snapapp: "SnapApp Pty Ltd",
      ftr: "FTR Pty Ltd",
      god: "GOD Pty Ltd",
    });
    expect(named.map((client) => client.operator)).toEqual([
      "SnapApp Pty Ltd",
      "SnapApp Pty Ltd",
      "SnapApp Pty Ltd",
      "FTR Pty Ltd",
      "FTR Pty Ltd",
      "GOD Pty Ltd",
    ]);
    expect(clientsFor("staging").map((client) => client.operator)).toEqual([
      "SnapApps",
      "SnapApps",
      "SnapApps",
      "Free Tax Returns",
      "Free Tax Returns",
      "Global Omni Data",
    ]);
    expect(named.find((client) => client.clientId === "ftr-web")?.externalOperator).toBe(true);
  });

  it("allows sign-in clients the four sign-in scopes, and the client APIs to machine clients only", () => {
    for (const client of CLIENTS) {
      if (client.kind === "machine") {
        expect(["teen_invites", "app_transfers", "spambank"]).toEqual(
          expect.arrayContaining([...client.allowedScopes]),
        );
      } else {
        expect(client.allowedScopes).toEqual(["openid", "email", "profile", "account"]);
      }
    }
    expect(
      CLIENTS.find((client) => client.clientId === "snapapp-staging-server")?.allowedScopes,
    ).toEqual(["teen_invites", "app_transfers", "spambank"]);
  });
});

describe("the Spambank machine clients (spambank/BUILD.md 5.2)", () => {
  it("lets SnapApp's and FTR's servers use the spambank scope, in their own sectors", () => {
    const server = (clientId: string) => CLIENTS.find((client) => client.clientId === clientId);
    expect(server("snapapp-staging-server")?.allowedScopes).toContain("spambank");
    expect(server("ftr-server")).toMatchObject({
      kind: "machine",
      app: "ftr",
      sector: "ftr",
      auth: "private_key_jwt",
      allowedScopes: ["spambank"],
      environments: ["dev", "staging"],
    });
  });

  it("gives no other client the scope", () => {
    expect(
      CLIENTS.filter((client) => client.allowedScopes.includes("spambank")).map(
        (client) => client.clientId,
      ),
    ).toEqual(["snapapp-staging-server", "ftr-server"]);
  });

  it("registers FTR's server as a client-credentials client when its public key file is there", () => {
    const loaded = loadClients(clientsFor("staging"), DIR, files(ALL_FILES));
    const metadata = loaded.metadata.find((one) => one.client_id === "ftr-server");
    expect(metadata?.grant_types).toEqual(["client_credentials"]);
    expect(metadata?.token_endpoint_auth_method).toBe("private_key_jwt");
    expect(metadata?.scope).toBe("spambank");
    expect(metadata?.jwks?.keys).toHaveLength(1);
  });
});

describe("the GOD dashboard client (group 9.4.a)", () => {
  const god = CLIENTS.filter(isSignInClient).find((client) => client.clientId === "god-dashboard");
  if (god === undefined) throw new Error("the GOD dashboard client is registered");

  it("is a confidential web client on private_key_jwt with one exact https redirect", () => {
    expect(god.kind).toBe("web");
    expect(god.auth).toBe("private_key_jwt");
    expect(god.redirectUris).toEqual(["https://dashboard.god.gaiada.com/auth/callback"]);
    expect(god.returnHost).toBe("dashboard.god.gaiada.com");
    expect(god.environments).toEqual(["dev", "staging"]);
  });

  it("has a sector of its own, refuses teens, and asks for the four sign-in scopes", () => {
    const others = CLIENTS.filter((client) => client.clientId !== "god-dashboard");
    expect(others.map((client) => client.sector)).not.toContain(god.sector);
    expect(god.sector).toBe("god-staging");
    expect(god.teens).toBe("refuse");
    expect(god.allowedScopes).toEqual(["openid", "email", "profile", "account"]);
    expect(god.externalOperator).toBe(false);
  });

  it("loads its public JWKS from <client_id>.jwks.json: pairwise, RS256, code flow only", () => {
    const loaded = loadClients(clientsFor("staging"), DIR, files(ALL_FILES));
    const metadata = loaded.metadata.find((one) => one.client_id === "god-dashboard");
    expect(metadata?.token_endpoint_auth_method).toBe("private_key_jwt");
    expect(metadata?.jwks?.keys).toHaveLength(1);
    expect(metadata?.subject_type).toBe("pairwise");
    expect(metadata?.id_token_signed_response_alg).toBe("RS256");
    expect(metadata?.grant_types).toEqual(["authorization_code"]);
    expect(metadata?.sector_identifier_uri).toBeUndefined();
  });

  it("is told about deletions and ended access at the dashboard's own receiver", () => {
    expect(god.eventsEndpoint).toBe("https://dashboard.god.gaiada.com/auth/yourtal/events");
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
      "god-staging",
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
      "https://snapapps.gaiada.com/oauth/yourtal",
      "https://snapapp.gaiada.com/oauth/yourtal",
      "https://app.snapapps.gaiada.com/oauth/yourtal",
      "https://snapapp.app.gaiada.com/oauth/yourtal",
    ]);
    expect(byId.get("ftr-web")?.redirect_uris).toEqual([
      "https://freetaxreturns.com.au/api/auth/oauth2/callback/yourtal",
    ]);
    // Two redirect hosts need a (never fetched) sector URI; one-URI clients stay as they were.
    // Pinned: it comes from the registry's sector, so adding a redirect URI never moves it.
    expect(byId.get("snapapp-staging-mobile")?.sector_identifier_uri).toBe(
      "https://snapapp-staging.sector.yourtal.invalid/",
    );
    // Two redirect hosts now (SnapApps' website moved 2026-11-27): the same pinned, never-fetched sector.
    expect(byId.get("snapapp-staging-web")?.sector_identifier_uri).toBe(
      "https://snapapp-staging.sector.yourtal.invalid/",
    );
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
      "ftr-server",
      "god-dashboard",
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

describe("returnHostFor (the host the consent screen names)", () => {
  const phone = CLIENTS.filter(isSignInClient).find((c) => c.clientId === "snapapp-staging-mobile");
  if (phone === undefined) throw new Error("the SnapApp phone client is registered");

  it("names the PWA's own host when the PWA's redirect is used", () => {
    expect(returnHostFor(phone, "https://app.snapapps.gaiada.com/oauth/yourtal")).toBe(
      "app.snapapps.gaiada.com",
    );
    expect(returnHostFor(phone, "https://snapapp.app.gaiada.com/oauth/yourtal")).toBe(
      "snapapp.app.gaiada.com",
    );
  });

  it("names the new website's host for a web redirect on it, and keeps the old one's name for the old redirect", () => {
    const web = CLIENTS.filter(isSignInClient).find((c) => c.clientId === "snapapp-staging-web");
    if (web === undefined) throw new Error("the SnapApp web client is registered");
    expect(returnHostFor(web, "https://snapapps.gaiada.com/auth/yourtal/callback")).toBe(
      "snapapps.gaiada.com",
    );
    expect(returnHostFor(web, "https://snapapp.gaiada.com/auth/yourtal/callback")).toBe(
      "snapapp.gaiada.com",
    );
    // A custom-scheme or unregistered redirect falls back to the configured host, now the new one.
    expect(returnHostFor(phone, "au.com.snapapps.app:/oauth/yourtal")).toBe("snapapps.gaiada.com");
  });

  it("names the App Link host for the App Link redirect", () => {
    expect(returnHostFor(phone, "https://snapapp.gaiada.com/oauth/yourtal")).toBe(
      "snapapp.gaiada.com",
    );
  });

  it("keeps the configured host for the app's own custom-scheme redirect", () => {
    expect(returnHostFor(phone, "au.com.snapapps.app:/oauth/yourtal")).toBe(phone.returnHost);
  });

  it("keeps the configured host when the redirect is missing or not registered", () => {
    expect(returnHostFor(phone, undefined)).toBe(phone.returnHost);
    expect(returnHostFor(phone, "https://evil.example/oauth/yourtal")).toBe(phone.returnHost);
  });
});
