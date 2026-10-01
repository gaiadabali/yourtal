import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { hash as hashPassword } from "@node-rs/argon2";
import { postSigned } from "../staging";
import type { StagingLedgerConfig } from "../staging";
import { DEMO_BRANDS } from "./catalogue";
import type { Region } from "./catalogue";
import { businessIdFor } from "./world";

/**
 * 13.1.a: the demo logins. A reset retires every current one (suspended, its
 * points escrowed with a posting, its email freed) and registers a fresh
 * account with a new id under the same email, so a reviewer always signs in
 * with the same address and starts clean. Nothing in the ledger is edited.
 */
const SNAP_APP: Readonly<Record<Region, string>> = {
  AU: "00000000-0000-4000-9000-000000000001",
  ID: "00000000-0000-4000-9000-000000000002",
};
const TIMEZONE: Readonly<Record<Region, string>> = {
  AU: "Australia/Sydney",
  ID: "Asia/Jakarta",
};

type BusinessRole = "owner" | "marketer" | "finance";
type StaffRole = "support" | "moderator" | "risk_analyst" | "finance" | "ops" | "admin";
const ALL_STAFF_ROLES: readonly StaffRole[] = [
  "support",
  "moderator",
  "risk_analyst",
  "finance",
  "ops",
  "admin",
];

export interface DemoPerson {
  readonly email: string;
  readonly region: Region;
  readonly displayName: string;
  readonly dateOfBirth: string;
  readonly trustTier: number;
  readonly teen?: true;
  readonly businessRole?: BusinessRole;
  readonly staffRole?: StaffRole;
  /** Kept across resets: the charities it runs belong to this account. */
  readonly keep?: true;
}

const ADULT = "1990-01-01";
/** Fourteen, whatever year the reset runs in. */
const teenBirthday = (): string => `${String(new Date().getUTCFullYear() - 14)}-03-01`;

function regionPeople(region: Region): DemoPerson[] {
  const r = region.toLowerCase();
  const au = region === "AU";
  const person = (email: string, displayName: string, extra: Partial<DemoPerson> = {}) => ({
    email: `${email}.${r}@demo.yourtal.test`,
    region,
    displayName,
    dateOfBirth: ADULT,
    trustTier: 3,
    ...extra,
  });
  return [
    // Tier 0 on purpose: the staging seed's pending-grant check needs a fresh viewer.
    person("viewer", au ? "Viewer Demo" : "Viewer Demo (ID)", { trustTier: 0 }),
    person("adult", au ? "Alex Viewer" : "Ayu Penonton"),
    person("teen", au ? "Taylor Teen" : "Tari Remaja", { dateOfBirth: teenBirthday(), teen: true }),
    person("guardian", au ? "Gemma Guardian" : "Gita Wali"),
    person("owner", `Owner Demo (${region})`, { businessRole: "owner" }),
    person("member", `Marketer Demo (${region})`, { businessRole: "marketer" }),
    person("finance", `Finance Demo (${region})`, { businessRole: "finance" }),
    // Run the demo charities (marketplace.ts applies with them; staff approve).
    person("charity1", au ? "Coastal Kids Trust" : "Yayasan Anak Pesisir", { keep: true }),
    person("charity2", au ? "Green Corridors Fund" : "Yayasan Hutan Kota", { keep: true }),
  ];
}

const STAFF: readonly DemoPerson[] = (
  [
    ["support", "Support Demo", "support"],
    ["moderator", "Moderator Demo", "moderator"],
    ["risk-analyst", "Risk Analyst Demo", "risk_analyst"],
    ["finance", "Finance Demo", "finance"],
    ["ops", "Ops Demo", "ops"],
    ["admin", "Admin Demo", "admin"],
  ] as const
).map(([local, displayName, staffRole]) => ({
  email: `${local}@demo.yourtal.test`,
  // Staff carry no region of their own; AU is a documented pick.
  region: "AU" as const,
  displayName,
  dateOfBirth: ADULT,
  trustTier: 3,
  staffRole,
}));

export const DEMO_PEOPLE: readonly DemoPerson[] = [
  ...regionPeople("AU"),
  ...regionPeople("ID"),
  ...STAFF,
];

async function userIdFor(pool: pg.Pool, email: string): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM identity.credential WHERE kind = 'password' AND identifier = $1",
    [email],
  );
  return rows[0]?.user_id ?? null;
}

interface LedgerBalance {
  readonly availablePoints: number;
  readonly pending: readonly { readonly points: number }[];
}

/** Retires one account. Idempotent: the escrow key names the amount, the rest are plain writes. */
async function retire(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  person: DemoPerson,
  userId: string,
  generation: string,
): Promise<void> {
  const balance = await postSigned(ledger, "/v1/wallet/balance", { userId });
  if (!balance.ok) throw new Error(`balance for ${person.email}: ${balance.detail}`);
  const body = balance.body as LedgerBalance;
  const points = body.availablePoints + body.pending.reduce((sum, b) => sum + b.points, 0);
  if (points > 0) {
    const held = await postSigned(ledger, "/v1/escrow", {
      userId,
      points,
      reason: "demo_reset",
      idempotencyKey: `demo-reset:${userId}:${String(points)}`,
    });
    if (!held.ok) throw new Error(`escrow for ${person.email}: ${held.detail}`);
  }
  await pool.query(
    "UPDATE identity.user_profile SET suspended_at = COALESCE(suspended_at, now()) WHERE user_id = $1",
    [userId],
  );
  await pool.query(
    "UPDATE identity.credential SET identifier = $2 WHERE user_id = $1 AND kind = 'password'",
    [userId, `retired-${generation}.${person.email}`],
  );
  await pool.query("DELETE FROM identity.session WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM business.business_members WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM identity.staff_role WHERE user_id = $1", [userId]);
}

/** The businesses a region's team belongs to: snap-app and every demo brand there. */
function teamBusinesses(region: Region): string[] {
  return [
    SNAP_APP[region],
    ...DEMO_BRANDS.filter((b) => b.region === region).map((b) => businessIdFor(b.slug)),
  ];
}

async function register(pool: pg.Pool, person: DemoPerson, passwordHash: string): Promise<string> {
  const userId = randomUUID();
  await pool.query(
    `INSERT INTO identity.credential (user_id, kind, identifier, secret_hash, verified_at)
     VALUES ($1, 'password', $2, $3, now())`,
    [userId, person.email, passwordHash],
  );
  await pool.query(
    `INSERT INTO identity.user_profile
       (user_id, region, display_locale, display_name, date_of_birth, timezone,
        parent_consent_status, trust_tier)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      person.region,
      person.region === "AU" ? "en-AU" : "id-ID",
      person.displayName,
      person.dateOfBirth,
      TIMEZONE[person.region],
      person.teen === true ? "granted" : "not_required",
      person.trustTier,
    ],
  );
  return userId;
}

export interface DemoLogin {
  readonly email: string;
  readonly userId: string;
  readonly region: Region;
  /** Only for a teen: the guardian's page, which is reached by link, not by login. */
  readonly guardianLink?: string;
}

/** Retires the current demo accounts and registers fresh ones with the same emails. */
export async function resetDemoAccounts(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  input: { readonly password: string; readonly siteUrl: string },
  log: (message: string) => void,
): Promise<readonly DemoLogin[]> {
  const generation = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const passwordHash = await hashPassword(input.password);
  const logins: DemoLogin[] = [];
  const created = new Map<string, string>();

  for (const person of DEMO_PEOPLE) {
    const previous = await userIdFor(pool, person.email);
    if (previous !== null && person.keep === true) {
      created.set(person.email, previous);
      logins.push({ email: person.email, userId: previous, region: person.region });
      continue;
    }
    if (previous !== null) await retire(pool, ledger, person, previous, generation);
    const userId = await register(pool, person, passwordHash);
    created.set(person.email, userId);

    // The demo admin holds every staff role, like the founder's own account (F85).
    const staffRoles =
      person.staffRole === "admin" ? ALL_STAFF_ROLES : person.staffRole ? [person.staffRole] : [];
    for (const role of staffRoles) {
      await pool.query(
        "INSERT INTO identity.staff_role (user_id, role, granted_by) VALUES ($1, $2, 'demo-reset')",
        [userId, role],
      );
    }
    let guardianLink: string | undefined;
    if (person.teen === true) {
      // A known link for the review guide; the token is stored only as its hash.
      const token = randomBytes(32).toString("base64url");
      await pool.query(
        `INSERT INTO identity.guardian_consent
           (user_id, token_hash, guardian_email, region, guardian_confirmed_adult_at, approved_at)
         VALUES ($1, $2, $3, $4, now(), now())`,
        [
          userId,
          createHash("sha256").update(token, "utf8").digest("hex"),
          `guardian.${person.region.toLowerCase()}@demo.yourtal.test`,
          person.region,
        ],
      );
      guardianLink = `${input.siteUrl}/guardian/${token}`;
    }
    logins.push({
      email: person.email,
      userId,
      region: person.region,
      ...(guardianLink ? { guardianLink } : {}),
    });
  }

  for (const person of DEMO_PEOPLE) {
    if (person.businessRole === undefined) continue;
    const userId = created.get(person.email);
    const owner = created.get(`owner.${person.region.toLowerCase()}@demo.yourtal.test`);
    if (userId === undefined || owner === undefined) continue;
    for (const businessId of teamBusinesses(person.region)) {
      const exists = await pool.query("SELECT 1 FROM business.business_accounts WHERE id = $1", [
        businessId,
      ]);
      if ((exists.rowCount ?? 0) === 0) continue;
      await pool.query(
        `INSERT INTO business.business_members (business_id, user_id, role, invited_by_user_id, joined_at)
         VALUES ($1, $2, $3, $4, now())`,
        [businessId, userId, person.businessRole, owner],
      );
    }
  }
  log(`[demo:reset] ${String(logins.length)} demo accounts registered (generation ${generation})`);
  return logins;
}
