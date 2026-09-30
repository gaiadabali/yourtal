#!/usr/bin/env node
// TASKS.md 13.20.d's Check: gifting over the real HTTP stack, in AU and ID,
// against a live voucher service. Per region it registers a sender, a
// recipient, a teen and an adult in the other region; gives the sender one
// voucher on a transferable listing (batch + reserve + activate on the
// voucher service, the state checkout leaves it in); then over the public
// API: gifts to the teen and the other-region adult (refused), gifts to the
// recipient, shows the old code refused at a paired counter, accepts,
// refuses a second gift, and redeems the new voucher at the counter.
// Finally reads the voucher rows, the gift row and both event chains.
//
// Env: API_BASE (default http://127.0.0.1:26481), DATABASE_OWNER_URL,
// VOUCHER_BASE_URL, VOUCHER_SERVICE_SECRET. Fixtures (businesses, listings,
// email verification, the teen's birth date) are written by SQL.
// Prints one "RESULT:" line; non-zero exit on the first failure.
import { randomUUID } from "node:crypto";
import { api, counter, db, events, expect, person, shop, voucher } from "./check-fixtures.mjs";

const RUN = randomUUID().slice(0, 8);

async function region(code, other) {
  const [sender, recipient, teen, owner, abroad] = [
    await person(code, "sender"),
    await person(code, "recipient"),
    await person(code, "teen"),
    await person(code, "owner"),
    await person(other, "abroad"),
  ];
  const ids = await shop(code, owner);
  const saga = `gift-check-${randomUUID()}`;
  const reserved = await voucher("/reservations", { listingId: ids.listing, sagaId: saga });
  await voucher("/reservations/activate", { sagaId: saga, ownerId: sender.id });
  const oldId = reserved.voucherId;
  const { code: oldCode } = await voucher("/vouchers/reveal", {
    voucherId: oldId,
    ownerId: sender.id,
  });

  const listed = await api("GET", `/api/wallet/vouchers/${oldId}`, sender.token);
  expect(
    listed.json.giftable === true,
    `the sender's voucher is not giftable: ${JSON.stringify(listed.json)}`,
  );

  const gift = (to) =>
    api("POST", `/api/wallet/vouchers/${oldId}/gift`, sender.token, { recipientEmail: to });
  const toTeen = await gift(teen.email);
  expect(
    toTeen.status === 409 && toTeen.json.code === "gift_recipient_ineligible",
    `teen recipient: ${toTeen.status} ${JSON.stringify(toTeen.json)}`,
  );
  const toAbroad = await gift(abroad.email);
  expect(
    toAbroad.status === 409 && toAbroad.json.code === "gift_recipient_ineligible",
    `cross-region recipient: ${toAbroad.status} ${JSON.stringify(toAbroad.json)}`,
  );
  const teenSends = await api("POST", `/api/wallet/vouchers/${oldId}/gift`, teen.token, {
    recipientEmail: recipient.email,
  });
  expect(
    teenSends.status === 403 || teenSends.status === 404,
    `a teen sending: ${teenSends.status}`,
  );

  const sent = await gift(recipient.email);
  expect(
    sent.status === 201 && sent.json.status === "pending",
    `gift: ${sent.status} ${JSON.stringify(sent.json)}`,
  );
  const giftId = sent.json.giftId;

  const till = await counter(owner, ids);
  const oldAtTill = await till.lookup(oldCode);
  expect(oldAtTill.status >= 400, `the old code still works at the counter: ${oldAtTill.status}`);
  const oldQr = await api("GET", `/api/wallet/vouchers/${oldId}/qr`, sender.token);
  expect(oldQr.status === 409, `the old voucher still shows a QR: ${oldQr.status}`);

  const teenAccepts = await api("POST", `/api/wallet/gifts/${giftId}/accept`, teen.token);
  expect(teenAccepts.status === 403, `a teen accepting: ${teenAccepts.status}`);
  const inbox = await api("GET", "/api/wallet/gifts", recipient.token);
  const received = inbox.json.gifts?.find((g) => g.giftId === giftId);
  expect(
    received?.direction === "received" && received.senderDisplayName === `Gift sender ${code}`,
    `recipient's gifts: ${JSON.stringify(inbox.json)}`,
  );
  const accepted = await api("POST", `/api/wallet/gifts/${giftId}/accept`, recipient.token);
  expect(
    accepted.status === 200 && accepted.json.status === "accepted",
    `accept: ${accepted.status} ${JSON.stringify(accepted.json)}`,
  );
  const newId = accepted.json.voucherId;

  const again = await api("POST", `/api/wallet/vouchers/${newId}/gift`, recipient.token, {
    recipientEmail: sender.email,
  });
  expect(
    again.status === 409 && again.json.code === "gift_already_gifted",
    `second gift: ${again.status} ${JSON.stringify(again.json)}`,
  );
  const regift = await gift(recipient.email);
  expect(
    regift.status === 201 && regift.json.giftId === giftId,
    `replaying the same gift must return it: ${regift.status}`,
  );

  const qr = await api("GET", `/api/wallet/vouchers/${newId}/qr`, recipient.token);
  expect(qr.status === 200, `new QR: ${qr.status}`);
  const capture = await till.redeem(qr.json.token);
  const after = await api("GET", `/api/wallet/vouchers/${newId}`, recipient.token);
  expect(after.json.status === "redeemed", `the new voucher is ${after.json.status}, not redeemed`);
  const senderView = await api("GET", `/api/wallet/vouchers/${oldId}`, sender.token);
  expect(
    senderView.json.status === "transferred",
    `the sender sees ${senderView.json.status}, not transferred`,
  );

  const { rows } = await db.query(
    `SELECT v.id, v.state, v.void_reason, v.owner_id, v.region, v.remaining_value_minor FROM voucher.vouchers v WHERE v.id = ANY($1)`,
    [[oldId, newId]],
  );
  const oldRow = rows.find((r) => r.id === oldId);
  const newRow = rows.find((r) => r.id === newId);
  expect(
    oldRow.state === "voided" && oldRow.void_reason === "transfer" && oldRow.owner_id === sender.id,
    `old row ${JSON.stringify(oldRow)}`,
  );
  expect(
    newRow.state === "redeemed" && newRow.owner_id === recipient.id && newRow.region === code,
    `new row ${JSON.stringify(newRow)}`,
  );
  const {
    rows: [giftRow],
  } = await db.query(`SELECT * FROM voucher.gift WHERE id = $1`, [giftId]);
  expect(
    giftRow.state === "accepted" &&
      giftRow.source_voucher_id === oldId &&
      giftRow.voucher_id === newId &&
      giftRow.region === code,
    `gift row ${JSON.stringify(giftRow)}`,
  );
  const oldChain = (await events(oldId)).map((e) => e.event_type);
  const newChain = await events(newId);
  expect(oldChain.at(-1) === "transferred", `old chain ${oldChain}`);
  expect(
    newChain[0].event_type === "minted" &&
      newChain[0].detail.remint_of === oldId &&
      newChain[0].detail.gift_id === giftId,
    `new chain head ${JSON.stringify(newChain[0])}`,
  );
  expect(
    newChain.map((e) => e.event_type).join(",") ===
      "minted,allocated,activated,authorized,captured",
    `new chain ${newChain.map((e) => e.event_type)}`,
  );
  return {
    region: code,
    giftId,
    oldVoucher: oldId,
    newVoucher: newId,
    captureId: capture.captureId,
    oldChain,
    newChain: newChain.map((e) => e.event_type),
  };
}

try {
  const au = await region("AU", "ID");
  const id = await region("ID", "AU");
  console.log(`RESULT:${JSON.stringify({ ok: true, run: RUN, au, id })}`);
} finally {
  await db.end();
}
