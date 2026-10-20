import { randomUUID } from "node:crypto";
import type pg from "pg";

/**
 * Rows for `dsar-me-tables.test.ts`: one person with a row in every table that
 * account deletion must reach. Written as the OWNER. Every person gets their
 * own campaign, business and charity, so two people share nothing a deletion
 * could take from the other.
 */
export interface Person {
  readonly id: string;
  readonly email: string;
}

export interface Seeded extends Person {
  readonly campaignId: string;
  readonly businessId: string;
  readonly charityId: string;
  readonly questionId: string;
  readonly optionId: string;
  readonly sessionId: string;
}

export async function hasTable(owner: pg.Pool, schema: string, table: string): Promise<boolean> {
  const { rows } = await owner.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  return rows.length > 0;
}

function shortCode(): string {
  return randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
}

async function seedMe(owner: pg.Pool, person: Person, campaignId: string): Promise<void> {
  const soon = new Date(Date.now() + 10 * 60 * 1000);
  const inserts: [string, unknown[]][] = [
    [`INSERT INTO me.interest (user_id, node_id) VALUES ($1, 'coffee')`, [person.id]],
    [
      `INSERT INTO me.follow (user_id, business_id, region) VALUES ($1, $2, 'AU')`,
      [person.id, randomUUID()],
    ],
    [`INSERT INTO me.save (user_id, campaign_id) VALUES ($1, $2)`, [person.id, campaignId]],
    [
      `INSERT INTO me.link_code (code, user_id, region, expires_at) VALUES ($2, $1, 'AU', $3)`,
      [person.id, shortCode(), soon],
    ],
    [
      `INSERT INTO me.streak_state (user_id, region, current_length) VALUES ($1, 'AU', 3)`,
      [person.id],
    ],
    [
      `INSERT INTO me.notification (user_id, region, category, title, body)
       VALUES ($1, 'AU', 'points_unlocked', 'Points unlocked', 'You have points to spend')`,
      [person.id],
    ],
    [
      `INSERT INTO me.notification_preference (user_id, category, push_enabled)
       VALUES ($1, 'points_unlocked', false)`,
      [person.id],
    ],
    [`INSERT INTO me.viewer_setting (user_id, autoplay) VALUES ($1, 'never')`, [person.id]],
    [`INSERT INTO me.viewer_theme (user_id, theme) VALUES ($1, 'dark')`, [person.id]],
    [
      `INSERT INTO me.voucher_expiry_warning (voucher_id, user_id, region, expires_at)
       VALUES ($2, $1, 'AU', $3)`,
      [person.id, randomUUID(), soon],
    ],
    [`INSERT INTO feed.demotion (user_id, campaign_id) VALUES ($1, $2)`, [person.id, campaignId]],
  ];
  // `me.viewer_area` arrives with the "my area" branch; once it is in, it is seeded too.
  if (await hasTable(owner, "me", "viewer_area")) {
    inserts.push([
      `INSERT INTO me.viewer_area (user_id, region, postcode) VALUES ($1, 'AU', '2000')`,
      [person.id],
    ]);
  }
  for (const [sql, params] of inserts) await owner.query(sql, params);
}

async function seedAccount(owner: pg.Pool, person: Person): Promise<void> {
  await owner.query(
    `INSERT INTO identity.verification_token (id, user_id, purpose, expires_at)
     VALUES ($2, $1, 'password_reset', now() + interval '1 hour')`,
    [person.id, `tok-${randomUUID()}`],
  );
  await owner.query(
    `INSERT INTO identity.principal_security_state (user_id, value_frozen_until)
     VALUES ($1, now() + interval '1 day')`,
    [person.id],
  );
}

async function seedOrganisations(owner: pg.Pool, person: Person, s: Seeded): Promise<void> {
  await owner.query(
    `INSERT INTO business.business_accounts
       (id, legal_name, display_name, tax_id_kind, tax_id_value,
        address_state, address_postcode, address_city, roles, region, currency, handle)
     VALUES ($1, 'Erasure Fixture Pty Ltd', 'Erasure Fixture', 'ABN', '12345678901',
             'NSW', '2000', NULL, '["advertiser"]'::jsonb, 'AU', 'AUD', $2)`,
    [s.businessId, `erase-${s.businessId.slice(0, 8)}`],
  );
  // One invitation this person accepted, and one they sent to somebody else.
  await owner.query(
    `INSERT INTO business.team_invitations
       (business_id, email, role, token_hash, invited_by_user_id, expires_at, accepted_at, accepted_by_user_id)
     VALUES ($1, $2, 'analyst', $3, $4, now() + interval '7 days', now(), $5),
            ($1, $6, 'analyst', $7, $5, now() + interval '7 days', now(), $8)`,
    [
      s.businessId,
      person.email,
      `hash-${randomUUID()}`,
      `inviter-${randomUUID()}`,
      person.id,
      `third-party-${randomUUID()}@example.test`,
      `hash-${randomUUID()}`,
      `someone-else-${randomUUID()}`,
    ],
  );
  await owner.query(
    `INSERT INTO charity.charity
       (id, region, name, cause, summary, registration, payout_account_name,
        payout_account_last4, kyb_reference, payout_reference, applied_by)
     VALUES ($1, 'AU', 'Erasure Fixture Charity', 'community', 'A fixture',
             '{"kind":"au_acnc"}'::jsonb, 'Fixture Account', '1234', 'kyb-fixture',
             'payout-fixture', $2)`,
    [s.charityId, `applicant-${randomUUID()}`],
  );
  await owner.query(`INSERT INTO charity.member (charity_id, user_id) VALUES ($1, $2)`, [
    s.charityId,
    person.id,
  ]);
}

async function seedWatch(owner: pg.Pool, person: Person, s: Seeded): Promise<void> {
  await owner.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule,
        lifecycle_state, published_at, business_id, region, audience, content_category,
        poster_url, teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at)
     VALUES ($1, 'long_form', 'dsar-me-tables fixture', $2,
             'Fixture Merchant', 'Owned by dsar-me-tables.test.ts',
             900, 20, 100, 1, 'base_only', 'live', now(), $2, 'AU', 'all_ages', 'food-and-drink',
             'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
             'https://cdn.example.com/hls.m3u8', '16:9', 1000000, now(), now() + interval '90 days')`,
    [s.campaignId, s.businessId],
  );
  await owner.query(
    `INSERT INTO campaign.terms_version
       (campaign_id, version, reward_points, question_count, scoring_rule,
        duration_seconds, accuracy_bonus_points, effective_from)
     VALUES ($1, 1, 100, 1, 'base_only', 900, 0, now())`,
    [s.campaignId],
  );
  await owner.query(
    `INSERT INTO campaign.question (id, campaign_id, type, prompt, timer_seconds, status, pii_screen)
     VALUES ($1, $2, 'multiple_choice', 'Owned by dsar-me-tables.test.ts', 20, 'approved', 'clear')`,
    [s.questionId, s.campaignId],
  );
  await owner.query(
    `INSERT INTO campaign.question_option (id, question_id, label, ordinal) VALUES ($1, $2, 'A', 0)`,
    [s.optionId, s.questionId],
  );
  await owner.query(
    `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at)
     VALUES ($1, $2, $3, 1, 'active', now(), now())`,
    [s.sessionId, person.id, s.campaignId],
  );
  await owner.query(
    `INSERT INTO watch.coverage (session_id, from_second, to_second) VALUES ($1, 0, 30)`,
    [s.sessionId],
  );
  await owner.query(
    `INSERT INTO watch.checkpoint_nonce (nonce, session_id, checkpoint_index, expires_at)
     VALUES ($2, $1, 0, now() + interval '1 hour')`,
    [s.sessionId, `nonce-${randomUUID()}`],
  );
  await owner.query(
    `INSERT INTO watch.checkpoint_issue (session_id, checkpoint_index, nonce, expires_at)
     VALUES ($1, 1, $2, now() + interval '1 hour')`,
    [s.sessionId, `issue-${randomUUID()}`],
  );
  await owner.query(
    `INSERT INTO campaign.question_response
       (session_id, question_id, selected_option_id, was_correct, latency_ms)
     VALUES ($1, $2, $3, true, 2500)`,
    [s.sessionId, s.questionId, s.optionId],
  );
}

export async function seedPerson(owner: pg.Pool, person: Person): Promise<Seeded> {
  const seeded: Seeded = {
    ...person,
    campaignId: randomUUID(),
    businessId: randomUUID(),
    charityId: randomUUID(),
    questionId: randomUUID(),
    optionId: randomUUID(),
    sessionId: randomUUID(),
  };
  await seedOrganisations(owner, person, seeded);
  await seedWatch(owner, person, seeded);
  await seedMe(owner, person, seeded.campaignId);
  await seedAccount(owner, person);
  return seeded;
}

const USER_TABLES = [
  "me.interest",
  "me.follow",
  "me.save",
  "me.link_code",
  "me.streak_state",
  "me.notification",
  "me.notification_preference",
  "me.viewer_setting",
  "me.viewer_theme",
  "me.voucher_expiry_warning",
  "feed.demotion",
  "identity.verification_token",
  "identity.principal_security_state",
  "charity.member",
];

/** Removes what a failed run would leave behind, as the owner. Safe to run twice. */
export async function cleanup(owner: pg.Pool, people: readonly Seeded[]): Promise<void> {
  for (const s of people) {
    for (const table of USER_TABLES) {
      await owner.query(`DELETE FROM ${table} WHERE user_id = $1`, [s.id]);
    }
    if (await hasTable(owner, "me", "viewer_area")) {
      await owner.query(`DELETE FROM me.viewer_area WHERE user_id = $1`, [s.id]);
    }
    const doomed = `SELECT id FROM watch.session WHERE campaign_id = $1`;
    for (const table of [
      "campaign.question_response",
      "watch.checkpoint_nonce",
      "watch.checkpoint_issue",
      "watch.coverage",
    ]) {
      await owner.query(`DELETE FROM ${table} WHERE session_id IN (${doomed})`, [s.campaignId]);
    }
    await owner.query(`DELETE FROM watch.session WHERE campaign_id = $1`, [s.campaignId]);
    await owner.query(`DELETE FROM campaign.question_option WHERE id = $1`, [s.optionId]);
    await owner.query(`DELETE FROM campaign.question WHERE id = $1`, [s.questionId]);
    await owner.query(`DELETE FROM campaign.terms_version WHERE campaign_id = $1`, [s.campaignId]);
    await owner.query(`DELETE FROM campaign.campaigns WHERE id = $1`, [s.campaignId]);
    await owner.query(`DELETE FROM business.team_invitations WHERE business_id = $1`, [
      s.businessId,
    ]);
    await owner.query(`DELETE FROM business.business_accounts WHERE id = $1`, [s.businessId]);
    await owner.query(`DELETE FROM charity.charity WHERE id = $1`, [s.charityId]);
  }
}
