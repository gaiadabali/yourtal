-- TASKS.md 10.5.b: which K13 disputes staff have resolved, and with what
-- recovery line. `checkout.dispute` stays exactly as 4.7.c built it --
-- append-only, `yourtal_app` has no UPDATE on it at all -- the same "own
-- narrow SQL, never edit the owning module" convention
-- staff-suspension-repository.ts and staff-dispute-queue.ts already follow.
-- The staff queue query excludes a voucher once it has a row here, rather
-- than `checkout.dispute.outcome` ever changing.
CREATE TABLE staff.dispute_resolution (
  voucher_id        uuid        PRIMARY KEY REFERENCES checkout.dispute (voucher_id),
  capture_id        text        NOT NULL,
  recovery_posting_id text      NOT NULL,
  resolved_by       text        NOT NULL,
  resolution_note   text        NOT NULL,
  resolved_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON staff.dispute_resolution TO yourtal_app;
REVOKE UPDATE, DELETE ON staff.dispute_resolution FROM yourtal_app;
