import type { Region } from "./catalogue";

/**
 * The demo people the demo-world reset (re)creates, one login each. Its own
 * file, free of database code, so the API's staging demo sign-in can read the
 * list without pulling in the seed.
 */
export type BusinessRole = "owner" | "marketer" | "finance";
export type StaffRole = "support" | "moderator" | "risk_analyst" | "finance" | "ops" | "admin";
export const ALL_STAFF_ROLES: readonly StaffRole[] = [
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
