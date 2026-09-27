-- 20260927150000_feed_module.sql granted table-level privileges on
-- feed.pacing_state/feed.demotion but never USAGE on the schema itself --
-- Postgres denies access to any object in a schema without it, table grants
-- notwithstanding ("permission denied for schema feed", caught by
-- feed.controller.e2e.test.ts against a real database, not assumed). Additive
-- fix in a new migration rather than editing the merged one.
GRANT USAGE ON SCHEMA feed TO yourtal_app;
