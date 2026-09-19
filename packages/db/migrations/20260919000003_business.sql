-- YT-0518: the business domain tables, matching the Drizzle schema in
-- apps/api/src/modules/business/persistence/schema/.
--
-- Written by hand rather than generated, and the reason is worth stating:
-- the Drizzle schema is the application's view of these tables, but the
-- migration is what actually exists. Where the two could disagree, the
-- database wins — so constraints that matter are stated here even when
-- Drizzle expresses them too (docs/13, module boundaries enforced twice).
--
-- docs/15: schema per domain, never a shared table. These live in `business`
-- and the ledger cannot see them any more than they can see the ledger.

CREATE TABLE business.business_accounts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name    text        NOT NULL,
  display_name  text        NOT NULL,
  district      text        NOT NULL,
  -- docs/17 section 2: a business may hold any subset of advertiser,
  -- supplier and redeemer, so this is a set rather than a single column.
  roles         jsonb       NOT NULL,
  is_verified   boolean     NOT NULL DEFAULT false,
  logo_url      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_accounts_roles_is_array CHECK (jsonb_typeof(roles) = 'array'),
  CONSTRAINT business_accounts_roles_not_empty CHECK (jsonb_array_length(roles) > 0)
);

CREATE TABLE business.business_members (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid        NOT NULL REFERENCES business.business_accounts (id),
  user_id             text        NOT NULL,
  -- docs/17 section 2.1's six roles. Store staff are absent by design: they
  -- are device sessions bound to a location, not members (section 2.2).
  role                text        NOT NULL CHECK (
                        role IN ('owner','admin','marketer','merchandiser','finance','analyst')),
  invited_at          timestamptz NOT NULL DEFAULT now(),
  invited_by_user_id  text        NOT NULL,
  joined_at           timestamptz
);

-- One membership per person per business. Without this a retried invite
-- leaves two rows for one human and "what role are they" stops having an
-- answer — which is also why the invite endpoint carries @Idempotent.
CREATE UNIQUE INDEX business_members_business_id_user_id_key
  ON business.business_members (business_id, user_id);

-- docs/17 section 2.1: "Exactly one Owner", transferable only by the current
-- owner with re-authentication. The re-auth half is enforced by the PDP
-- (policies/resource_policies/team.yaml); the uniqueness half cannot be, so
-- it is a partial unique index here. Two places, because a policy cannot
-- constrain a table and a table cannot read a session.
CREATE UNIQUE INDEX business_members_single_owner
  ON business.business_members (business_id)
  WHERE role = 'owner';

CREATE TABLE business.billing_contacts (
  business_id  uuid        PRIMARY KEY REFERENCES business.business_accounts (id),
  name         text        NOT NULL,
  email        text        NOT NULL,
  phone        text        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business.kyb_documents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid        NOT NULL REFERENCES business.business_accounts (id),
  document_type  text        NOT NULL,
  -- An opaque pointer to wherever the encrypted bytes live. NOTHING HERE
  -- ENCRYPTS A DOCUMENT — YT-0100 tracked metadata only, and the KMS
  -- envelope-encryption and signed-upload path is still unbuilt.
  storage_ref    text        NOT NULL,
  status         text        NOT NULL CHECK (status IN ('submitted','verified','rejected','expired')),
  expires_at     timestamptz,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  verified_at    timestamptz,
  verified_by_user_id text,

  -- A document cannot be verified without recording who verified it and
  -- when. docs/17 section 5 puts KYB review under ops, and an approval with
  -- no reviewer is not an audit trail.
  CONSTRAINT kyb_documents_verified_has_reviewer CHECK (
    status <> 'verified' OR (verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL)
  )
);

CREATE INDEX kyb_documents_business_idx ON business.kyb_documents (business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  business.business_accounts,
  business.business_members,
  business.billing_contacts,
  business.kyb_documents
TO yourtal_app;
