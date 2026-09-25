"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { ChannelAvatar, PointsChip, StreakFlame } from "./bits";
import { LISTINGS, STREAK_DAYS, VOUCHERS, media, type Listing, type Voucher } from "./lab-data";
import { useProto } from "./proto-context";

function ScreenTitle({ children }: { children: string }) {
  return (
    <h1 className="px-4 pt-4 pb-2 font-(family-name:--lab-display) text-3xl font-extrabold">
      {children}
    </h1>
  );
}

/** A shoppable grid: the product first, the price as a points chip. */
export function Store() {
  const { available, spend } = useProto();
  const [open, setOpen] = useState<Listing | null>(null);
  return (
    <div className="pb-6">
      <ScreenTitle>Store</ScreenTitle>
      <p className="px-4 pb-3 text-(--lab-fg-muted)">Spend points at places near you.</p>
      <ul className="grid grid-cols-2 gap-3 px-4">
        {LISTINGS.map((listing) => (
          <li key={listing.id}>
            <button
              type="button"
              onClick={() => setOpen(listing)}
              className="flex w-full flex-col overflow-hidden rounded-2xl bg-(--lab-surface) text-left"
            >
              <img
                src={media(listing.poster, "jpg")}
                alt=""
                className="aspect-[4/5] w-full object-cover"
              />
              <span className="flex flex-col gap-1.5 p-3">
                <span className="flex items-center gap-1.5 text-xs text-(--lab-fg-muted)">
                  <ChannelAvatar channel={listing.channel} size={20} />
                  <span className="truncate">{listing.channel.name}</span>
                </span>
                <span className="font-semibold leading-tight">{listing.title}</span>
                <PointsChip value={listing.pricePts} size="sm" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="listing-title"
          className="lab-pop fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[480px] flex-col gap-3 rounded-t-3xl border-t border-(--lab-border) bg-(--lab-surface) p-5 pb-8"
        >
          <p
            id="listing-title"
            className="font-(family-name:--lab-display) text-2xl font-extrabold"
          >
            {open.title}
          </p>
          <p className="text-(--lab-fg-muted)">
            At {open.channel.name}. You have {available.toLocaleString("en-AU")} points available.
          </p>
          <button
            type="button"
            disabled={available < open.pricePts}
            onClick={() => {
              spend(open.pricePts);
              setOpen(null);
            }}
            className="h-12 rounded-full bg-(--lab-accent) font-bold text-(--lab-fg-on-accent) disabled:opacity-50"
          >
            Redeem for {open.pricePts.toLocaleString("en-AU")} pts
          </button>
          <button type="button" onClick={() => setOpen(null)} className="h-11 font-semibold">
            Not now
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Pass({ voucher }: { voucher: Voucher }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(`yourtal:v1:${voucher.code}`, { margin: 1, width: 360 }).then(setQr);
  }, [voucher.code]);
  return (
    <li className="overflow-hidden rounded-3xl bg-(--lab-surface) shadow-lg">
      <div
        className="flex items-center gap-3 p-4 text-white"
        style={{ backgroundColor: voucher.channel.hue }}
      >
        <ChannelAvatar channel={voucher.channel} size={36} />
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">{voucher.channel.name}</span>
          <span className="font-(family-name:--lab-display) text-xl font-extrabold">
            {voucher.title}
          </span>
        </span>
      </div>
      <div className="flex flex-col items-center gap-3 border-t-2 border-dashed border-(--lab-border) p-5">
        <div className="rounded-2xl bg-white p-3">
          {qr ? (
            <img src={qr} alt={`QR code for ${voucher.code}`} className="size-44" />
          ) : (
            <span className="block size-44" />
          )}
        </div>
        <span className="font-(family-name:--lab-mono) text-lg tracking-widest">
          {voucher.code}
        </span>
        <span className="text-sm text-(--lab-fg-muted)">
          Show this at the counter · valid until {voucher.validUntil}
        </span>
      </div>
    </li>
  );
}

export function Wallet() {
  return (
    <div className="pb-6">
      <ScreenTitle>Wallet</ScreenTitle>
      <ul className="flex flex-col gap-4 px-4">
        {VOUCHERS.map((voucher) => (
          <Pass key={voucher.id} voucher={voucher} />
        ))}
      </ul>
    </div>
  );
}

export function Me() {
  const { theme, setTheme, available } = useProto();
  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenTitle>Me</ScreenTitle>
      <div className="mx-4 flex items-center gap-3 rounded-2xl bg-(--lab-surface) p-4">
        <PointsChip value={available} />
        <span className="text-(--lab-fg-muted)">available</span>
        <span className="ml-auto">
          <StreakFlame days={STREAK_DAYS} />
        </span>
      </div>
      <fieldset className="mx-4 flex gap-2 rounded-2xl bg-(--lab-surface) p-2">
        <legend className="sr-only">Theme</legend>
        {(["light", "dark"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={theme === option}
            onClick={() => setTheme(option)}
            className={`h-11 flex-1 rounded-xl font-semibold capitalize ${theme === option ? "bg-(--lab-accent) text-(--lab-fg-on-accent)" : ""}`}
          >
            {option}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
