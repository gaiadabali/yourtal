-- 1.4.f: identity.credential needs a DELETE grant for the DSAR erasure
-- handler (packages/db/src/dsar-handlers.ts) to remove a subject's
-- credential row. The original grant (20260921180000) was SELECT, INSERT,
-- UPDATE only -- there was no erasure path yet to need more. Additive only:
-- widens what the already-trusted `yourtal_app` role may do to rows it can
-- already read and rewrite in full (UPDATE has no column restriction here,
-- unlike voucher.vouchers' bearer-instrument case), not a new capability
-- class.
GRANT DELETE ON identity.credential TO yourtal_app;
