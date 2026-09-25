-- 4.5: columns the voucher-internal API needs.
--
-- saga_id / reserved_until on voucher.vouchers: `reserve(listing, sagaId)`
-- IS the stock reservation (Minted -> Allocated), and the saga that placed
-- the hold needs to find it again for `release`/`activate`. Nullable: only
-- an allocated voucher carries them, and `release` leaves the old values in
-- place rather than clearing them (harmless -- a future reserve overwrites
-- them, and `state = 'minted'` is what governs availability, not these).
-- region (4.5.e): denormalised from the listing at mint time, the same way
-- merchant_name and title already are — a voucher stays honourable offline
-- and immune to a later edit of the listing. AU is AU and ID is ID (F2):
-- authorize refuses a merchant whose own currency does not match, and since
-- currency is 1:1 with region in this system, that check IS the region
-- check. This column makes the fact queryable directly rather than only
-- implied by currency.
ALTER TABLE voucher.vouchers
  ADD COLUMN region text NOT NULL DEFAULT 'AU',
  ADD COLUMN saga_id text,
  ADD COLUMN reserved_until timestamptz;

ALTER TABLE voucher.vouchers ALTER COLUMN region DROP DEFAULT;

CREATE INDEX voucher_vouchers_saga_id ON voucher.vouchers (saga_id) WHERE saga_id IS NOT NULL;

-- `vouchers_owner_iff_issued` (20260920035523) was written when `minted` was
-- the only pre-ownership state: `(state = 'minted') = (owner_id IS NULL)`.
-- `reserve` (4.5.a) adds a second one -- `allocated` is now a SAGA'S
-- reservation, owned by nobody until `activate` -- so the equality has to
-- cover both. `expired`/`voided` are reachable from either an owned or an
-- unowned voucher (lifecycle.Transitions: minted and active can both reach
-- them), so they are excluded from the equality rather than forced either
-- way -- the same gap the original constraint already had for a minted
-- voucher voided directly, made explicit instead of silently widened.
ALTER TABLE voucher.vouchers DROP CONSTRAINT vouchers_owner_iff_issued;
ALTER TABLE voucher.vouchers ADD CONSTRAINT vouchers_owner_iff_issued CHECK (
  state IN ('expired', 'voided') OR (state IN ('minted', 'allocated')) = (owner_id IS NULL)
);

-- device_id on voucher.authorization: 4.5.c's device mode. NULL means the
-- hold was placed by a merchant HMAC credential with no device attached
-- (today's only path); a device-scoped credential (4.5.d) fills it in.
ALTER TABLE voucher.authorization
  ADD COLUMN device_id text;

-- device_id on voucher.merchant_credential: 4.5.d issues one credential per
-- device. NULL is reserved for a legacy merchant-wide key, which is what may
-- call void/refund -- a device-scoped credential is refused there (403).
ALTER TABLE voucher.merchant_credential
  ADD COLUMN device_id text;

-- requested_by/approved_by were typed uuid, but the voucher-internal
-- contract's requestBatch/approveBatch (1.2.b) carry a free-text staff
-- identifier ("staff-1"), the same convention
-- ledger.backing_rate_approval.approved_by already uses (text, not uuid) --
-- this brings the batch table in line rather than leaving a second, silently
-- incompatible convention.
ALTER TABLE voucher.batch
  ALTER COLUMN requested_by TYPE text USING requested_by::text,
  ALTER COLUMN approved_by TYPE text USING approved_by::text;

-- 4.5.a, D3: Allocated -> Minted is `release` -- a reservation compensated
-- because the saga never posted a burn. Mirrors
-- services/voucher/internal/lifecycle.Transitions; a Go test asserts the two
-- agree for every pair of states.
CREATE OR REPLACE FUNCTION voucher.transition_allowed(from_state text, to_state text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT (from_state, to_state) IN (
    ('minted', 'allocated'), ('minted', 'voided'), ('minted', 'expired'),
    ('allocated', 'active'), ('allocated', 'voided'), ('allocated', 'expired'), ('allocated', 'minted'),
    ('active', 'held'), ('active', 'redeemed'), ('active', 'expired'), ('active', 'voided'),
    ('held', 'active'), ('held', 'redeemed'), ('held', 'voided'),
    ('expired', 'active')
  )
$$;
