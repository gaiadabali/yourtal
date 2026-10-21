#!/usr/bin/env node
// Group 3.9 (docs/26 §1.8): the OpenID Connect provider's signing keys and
// cookie keys, and their rotation. Prints key ids and paths only, never key
// material. Restart the API after every step that changes a file.
//
//   node scripts/oidc-keys.mjs init <dir>          first jwks.json and cookie-keys.json
//   node scripts/oidc-keys.mjs add-next <dir>      day 0: publish the next key, unused
//   node scripts/oidc-keys.mjs promote <dir>       day 7: the next key signs; new cookie key
//   node scripts/oidc-keys.mjs remove-old <dir>    day 14: drop the old key and cookie key
//   node scripts/oidc-keys.mjs status <dir>        which key signs, which are published
//   node scripts/oidc-keys.mjs client-secret <clients dir> <client_id>
//                                                  a client_secret_basic secret, e.g. FTR's
//
// <dir> is where OIDC_JWKS_PATH points (/opt/yourtal/secrets/oidc on Helios).
// The first key in jwks.json signs and the rest are only published; the first
// cookie key signs and the rest only verify. Emergency rotation: remove-old
// after promote on the same day (apps re-fetch the JWKS on an unknown kid).
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const [command, dir, clientId] = process.argv.slice(2);

function fail(message) {
  console.error(`oidc-keys: ${message}`);
  process.exit(1);
}

function usage() {
  fail(
    "usage: oidc-keys.mjs init|add-next|promote|remove-old|status <dir>, or client-secret <dir> <client_id>",
  );
}

if (command === undefined || dir === undefined) usage();

const jwksPath = path.join(dir, "jwks.json");
const cookiesPath = path.join(dir, "cookie-keys.json");

/** Write through a private temp file and a rename, then leave it read-only for its owner. */
function writePrivate(file, contents) {
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, contents, { mode: 0o600 });
  // Windows will not rename over a read-only file; Linux does not mind either way.
  if (existsSync(file)) chmodSync(file, 0o600);
  renameSync(temp, file);
  chmodSync(file, 0o400);
}

function writeSecret(file, value) {
  writePrivate(file, `${JSON.stringify(value, null, 2)}\n`);
}

function read(file) {
  if (!existsSync(file)) fail(`${file} does not exist; run init first`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // JSON.parse quotes the text near the fault, which here is key material.
    return fail(`${file} is not valid JSON`);
  }
}

/** A key id is never reused: apps cache keys by kid. */
function newKid() {
  return `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
}

function newSigningKey() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    ...privateKey.export({ format: "jwk" }),
    kid: newKid(),
    alg: "RS256",
    use: "sig",
  };
}

const newCookieKey = () => randomBytes(32).toString("base64url");

function status() {
  const jwks = read(jwksPath);
  const { keys } = jwks;
  const cookies = read(cookiesPath).keys;
  keys.forEach((key, index) => {
    const role =
      index === 0
        ? "signing"
        : key.kid === jwks.next
          ? "next, published, not signing yet"
          : "old, verify only";
    console.log(`${key.kid}\t${role}`);
  });
  console.log(`cookie keys: ${String(cookies.length)} (the first signs)`);
}

switch (command) {
  case "init": {
    if (existsSync(jwksPath) || existsSync(cookiesPath)) fail(`keys already exist in ${dir}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeSecret(jwksPath, { keys: [newSigningKey()] });
    writeSecret(cookiesPath, { keys: [newCookieKey()] });
    status();
    break;
  }
  case "add-next": {
    const jwks = read(jwksPath);
    if (jwks.next !== undefined || jwks.keys.length > 1) {
      fail("a rotation is already under way: promote or remove-old first");
    }
    const key = newSigningKey();
    jwks.keys.push(key);
    // The marker is what promote acts on, so a second promote cannot swap back.
    writeSecret(jwksPath, { keys: jwks.keys, next: key.kid });
    status();
    break;
  }
  case "promote": {
    const jwks = read(jwksPath);
    const index = jwks.keys.findIndex((key) => key.kid === jwks.next);
    if (jwks.next === undefined || index < 1) {
      fail("no published, unused next key to promote: run add-next first");
    }
    const [next] = jwks.keys.splice(index, 1);
    writeSecret(jwksPath, { keys: [next, ...jwks.keys] });
    const cookies = read(cookiesPath);
    writeSecret(cookiesPath, { keys: [newCookieKey(), cookies.keys[0]] });
    status();
    break;
  }
  case "remove-old": {
    const jwks = read(jwksPath);
    // Keeps only the signing key, so it can never remove that one. A next key
    // that has not signed yet must be promoted first, or it would just vanish.
    if (jwks.next !== undefined) fail("the next key has not been promoted yet: run promote first");
    const cookies = read(cookiesPath);
    if (jwks.keys.length === 1 && cookies.keys.length === 1) fail("there is no old key to remove");
    writeSecret(jwksPath, { keys: jwks.keys.slice(0, 1) });
    writeSecret(cookiesPath, { keys: cookies.keys.slice(0, 1) });
    status();
    break;
  }
  case "status":
    status();
    break;
  case "client-secret": {
    if (clientId === undefined || !/^[a-z0-9-]+$/.test(clientId)) usage();
    const file = path.join(dir, `${clientId}.secret`);
    if (existsSync(file)) fail(`${file} already exists`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writePrivate(file, `${randomBytes(32).toString("base64url")}\n`);
    console.log(`wrote ${file}; give its contents to the app's operator over a secure channel`);
    break;
  }
  default:
    usage();
}
