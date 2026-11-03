-- Group 5.13.g (YourTal 14.22.g): the counter's "today" list showed a raw order
-- id because the log kept nothing that names the voucher. The BFF now saves the
-- voucher's title at authorize (it previews the voucher first anyway) and copies
-- it to the capture row. Nullable: rows from before this have no title and the
-- screen shows a plain "Voucher" for them.
ALTER TABLE store.counter_authorization_meta ADD COLUMN offer_title text;
ALTER TABLE store.counter_capture_log ADD COLUMN offer_title text;
