#!/usr/bin/env node
// TASKS.md 13.22.f's Check: a charity auction over the real HTTP stack,
// against a live voucher service, in AU and ID. A seller lists a voucher
// (its old code is then refused at a paired counter); a teen and an
// other-region adult are refused; two bidders race at one amount and one
// leads; the close captures the winner's hold into the charity's own
// provider account with no ledger posting at all; the winner's new code
// redeems at the counter. The charity is an approved row written by SQL
// (13.21's review flow is its own Check), and the close is brought forward
// by SQL rather than waiting 3 days.
//
// Env: API_BASE (default http://127.0.0.1:26481), DATABASE_OWNER_URL,
// VOUCHER_BASE_URL, VOUCHER_SERVICE_SECRET. Prints one "RESULT:" line.
import { randomUUID } from "node:crypto";
import { api, counter, db, events, expect, person, shop, voucher } from "./check-fixtures.mjs";

async function charity(region, admin) {
  const id = randomUUID();
  const payout = `simpayout_${randomUUID().slice(0, 12)}`;
  const registration =
    region === "AU"
      ? { kind: "au_acnc", abn: "51824753556", acncRegistered: true }
      : { kind: "id_yayasan", deedNumber: "AHU-0001", fundraisingPermitNumber: "PUB-0001" };
  await db.query(
    `INSERT INTO charity.charity (id, region, name, cause, summary, registration,
       payout_account_name, payout_account_last4, kyb_reference, payout_reference, state,
       applied_by, decided_by, decided_at)
     VALUES ($1, $2, $3, 'education', 'Check charity', $4, $3, '4321', 'simkyb_check', $5,
             'approved', $6, 'check-staff', now())`,
    [id, region, `Check Charity ${region}`, JSON.stringify(registration), payout, admin.id],
  );
  await db.query(`INSERT INTO charity.member (charity_id, user_id) VALUES ($1, $2)`, [
    id,
    admin.id,
  ]);
  return { id, payout };
}

const ledgerRows = async () =>
  (
    await db.query(
      `SELECT (SELECT count(*) FROM ledger.entry) + (SELECT count(*) FROM ledger.transfer) AS n`,
    )
  ).rows[0].n;

async function region(code, other) {
  const [seller, a, b, teen, owner, admin, abroad] = [
    await person(code, "seller"),
    await person(code, "bidder-a"),
    await person(code, "bidder-b"),
    await person(code, "teen"),
    await person(code, "owner"),
    await person(code, "charity"),
    await person(other, "abroad"),
  ];
  const ids = await shop(code, owner);
  const { id: charityId, payout } = await charity(code, admin);
  const saga = `auction-check-${randomUUID()}`;
  const reserved = await voucher("/reservations", { listingId: ids.listing, sagaId: saga });
  await voucher("/reservations/activate", { sagaId: saga, ownerId: seller.id });
  const oldId = reserved.voucherId;
  const { code: oldCode } = await voucher("/vouchers/reveal", {
    voucherId: oldId,
    ownerId: seller.id,
  });

  const listed = await api("POST", `/api/wallet/vouchers/${oldId}/auction`, seller.token, {
    charityId,
  });
  expect(listed.status === 201, `list: ${listed.status} ${JSON.stringify(listed.json)}`);
  const auction = listed.json;
  const till = await counter(owner, ids);
  const oldAtTill = await till.lookup(oldCode);
  expect(oldAtTill.status >= 400, `the listed voucher's old code still works: ${oldAtTill.status}`);

  const url = `/api/auctions/${auction.auctionId}`;
  const bid = (who, amountMinor) => api("POST", `${url}/bids`, who.token, { amountMinor });
  const reserve = auction.reserveMinor;
  const teenBid = await bid(teen, reserve);
  expect(teenBid.status === 403, `a teen bidding: ${teenBid.status}`);
  const abroadBid = await bid(abroad, reserve);
  expect(abroadBid.status === 403, `an other-region bidder: ${abroadBid.status}`);
  const teenView = await api("GET", url, teen.token);
  expect(teenView.status === 403, `a teen viewing: ${teenView.status}`);

  const raced = await Promise.all([bid(a, reserve), bid(b, reserve)]);
  const statuses = raced.map((r) => r.status).sort();
  expect(statuses[0] === 201 && statuses[1] === 409, `a race at one amount: ${statuses}`);
  const winner = raced[0].status === 201 ? b : a; // the loser outbids
  const top = raced.find((r) => r.status === 201).json.minimumNextBidMinor;
  const outbid = await bid(winner, top);
  expect(
    outbid.status === 201 && outbid.json.bidCount === 2,
    `outbid: ${outbid.status} ${JSON.stringify(outbid.json)}`,
  );
  const text = JSON.stringify(outbid.json);
  expect(!text.includes(a.id) && !text.includes(b.id), "a bidder id reached the client");

  const ledgerBefore = await ledgerRows();
  await db.query(`UPDATE auction.auction SET ends_at = now() - interval '1 second' WHERE id = $1`, [
    auction.auctionId,
  ]);
  const closed = await api("GET", url, winner.token);
  expect(
    closed.json.outcome === "sold" && closed.json.viewer.bidStatus === "won",
    `close: ${JSON.stringify(closed.json)}`,
  );
  const ledgerAfter = await ledgerRows();
  expect(
    ledgerAfter === ledgerBefore,
    `the close posted to the ledger (${ledgerBefore} -> ${ledgerAfter})`,
  );

  const {
    rows: [settlement],
  } = await db.query(`SELECT * FROM auction.settlement WHERE auction_id = $1`, [auction.auctionId]);
  expect(
    settlement.destination_reference === payout &&
      settlement.winner_id === winner.id &&
      Number(settlement.amount_minor) === top,
    `settlement ${JSON.stringify(settlement)}`,
  );
  const { rows: bids } = await db.query(
    `SELECT bidder_id, state FROM auction.bid WHERE auction_id = $1`,
    [auction.auctionId],
  );
  expect(
    bids.filter((x) => x.state === "captured").length === 1 &&
      bids.filter((x) => x.state === "held").length === 0,
    `bids ${JSON.stringify(bids)}`,
  );
  const {
    rows: [escrow],
  } = await db.query(`SELECT * FROM voucher.escrow WHERE auction_id = $1`, [auction.auctionId]);
  expect(
    escrow.state === "released" && escrow.released_to === winner.id,
    `escrow ${JSON.stringify(escrow)}`,
  );

  const qr = await api("GET", `/api/wallet/vouchers/${escrow.voucher_id}/qr`, winner.token);
  expect(qr.status === 200, `the winner's QR: ${qr.status}`);
  const captured = await till.redeem(qr.json.token);
  const {
    rows: [won],
  } = await db.query(`SELECT state, owner_id FROM voucher.vouchers WHERE id = $1`, [
    escrow.voucher_id,
  ]);
  expect(
    won.state === "redeemed" && won.owner_id === winner.id,
    `won voucher ${JSON.stringify(won)}`,
  );
  const chain = (await events(escrow.voucher_id)).map((e) => e.event_type).join(",");
  expect(chain === "minted,allocated,activated,authorized,captured", `won chain ${chain}`);
  const { rows: receipts } = await db.query(
    `SELECT party FROM auction.receipt WHERE auction_id = $1 ORDER BY party`,
    [auction.auctionId],
  );
  expect(
    receipts.map((r) => r.party).join(",") === "charity,seller,winner",
    `receipts ${JSON.stringify(receipts)}`,
  );
  return {
    region: code,
    auctionId: auction.auctionId,
    amountMinor: top,
    destination: settlement.destination_reference,
    captureReference: settlement.capture_reference,
    voucherCapture: captured.captureId,
    ledgerRowsUnchanged: true,
  };
}

try {
  const au = await region("AU", "ID");
  const id = await region("ID", "AU");
  console.log(`RESULT:${JSON.stringify({ ok: true, au, id })}`);
} finally {
  await db.end();
}
