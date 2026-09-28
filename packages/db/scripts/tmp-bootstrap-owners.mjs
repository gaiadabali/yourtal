import pg from "pg";
import { randomUUID } from "node:crypto";
import { hash as hashPassword } from "@node-rs/argon2";

const pool = new pg.Pool({
  connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c",
});

const PASSWORD = "e2e-phase8c-bootstrap-pw-1";

async function makeOwner({ email, region, businessId }) {
  const userId = randomUUID();
  const secretHash = await hashPassword(PASSWORD);
  await pool.query(
    `INSERT INTO identity.credential (user_id, kind, identifier, secret_hash, verified_at)
     VALUES ($1, 'password', $2, $3, now())`,
    [userId, email, secretHash],
  );
  await pool.query(
    `INSERT INTO identity.user_profile
       (user_id, region, display_locale, display_name, date_of_birth, timezone)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, region, region === "AU" ? "en-AU" : "id-ID", "e2e bootstrap owner", "1990-01-01",
      region === "AU" ? "Australia/Sydney" : "Asia/Jakarta"],
  );
  await pool.query(
    `INSERT INTO business.business_members (business_id, user_id, role, invited_by_user_id, joined_at)
     VALUES ($1, $2, 'owner', $2, now())`,
    [businessId, userId],
  );
  return { userId, email, password: PASSWORD };
}

const au = await makeOwner({
  email: `e2e-owner-au-${Date.now()}@demo.yourtal.test`, region: "AU",
  businessId: "00000000-0000-4000-8000-000000000603",
});
const id = await makeOwner({
  email: `e2e-owner-id-${Date.now()}@demo.yourtal.test`, region: "ID",
  businessId: "00000000-0000-4000-8000-000000000601",
});

console.log(JSON.stringify({ au, id }, null, 2));
await pool.end();
