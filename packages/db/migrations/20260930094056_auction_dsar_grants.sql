-- 13.22: erasure severs a person from auctions too (seller, bidder, winner,
-- receipt), as voucher.anonymise_owner does for vouchers, gifts and escrows.
GRANT UPDATE (winner_id, voucher_owner_id) ON auction.settlement TO yourtal_app;
GRANT UPDATE (recipient_id) ON auction.receipt TO yourtal_app;
