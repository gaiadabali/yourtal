-- Schema-per-domain, per docs/15: "schema per domain, never a shared table".
-- Roles are created here so the ledger can be isolated from day one rather
-- than retrofitted — docs/02 requires the ledger to have its own credential.
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE SCHEMA IF NOT EXISTS business;
CREATE SCHEMA IF NOT EXISTS campaign;
CREATE SCHEMA IF NOT EXISTS store;
CREATE SCHEMA IF NOT EXISTS voucher;
CREATE SCHEMA IF NOT EXISTS platform;

-- One role per domain. Local passwords only; real credentials come from
-- Secret Manager in deployed environments (YT-0026).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourtal_ledger') THEN
    CREATE ROLE yourtal_ledger LOGIN PASSWORD 'ledger_local_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourtal_app') THEN
    CREATE ROLE yourtal_app LOGIN PASSWORD 'app_local_only';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA ledger TO yourtal_ledger;
GRANT USAGE ON SCHEMA business, campaign, store, voucher, platform TO yourtal_app;

-- The ledger role is the only one that may touch ledger tables, and the app
-- role is explicitly denied. A cross-module table read then fails as a
-- permission error in development rather than as a surprise in production
-- (docs/13, module boundaries enforced twice).
REVOKE ALL ON SCHEMA ledger FROM yourtal_app;
