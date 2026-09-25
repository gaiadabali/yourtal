-- 4.6.c, D5: a minimum spend is a floor on the order, so the hold records
-- the order total it was placed against. NULL on holds from before this.
ALTER TABLE voucher.authorization
  ADD COLUMN order_total_minor bigint,
  ADD CONSTRAINT authorization_draw_within_order
    CHECK (order_total_minor IS NULL OR order_total_minor >= amount_minor);
