"use client";

import * as React from "react";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { MediaCard } from "@yourtal/ui/media-card";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { PointsChip } from "@yourtal/ui/points-chip";
import { QRPanel } from "@yourtal/ui/qr-panel";
import { GalleryRow, GallerySection } from "../lib/gallery-section";
import { placeholderImage } from "../lib/placeholder-image";
import { qrCodeDataUrl } from "../lib/qr-code";

const POINTS_SIZES = ["sm", "md", "lg"] as const;

/** Points, money, channels and video tiles — the reward and media primitives unique to YourTal. */
export function RewardsMediaGroup() {
  const qrSrc = React.useMemo(() => qrCodeDataUrl("https://yourtal.app/redeem/AB12CD34"), []);

  return (
    <>
      <GallerySection
        id="points"
        title="PointsChip"
        description="The one way to show a points amount, in every size."
      >
        <GalleryRow label="Sizes">
          {POINTS_SIZES.map((size) => (
            <PointsChip key={size} value={1240} size={size} aria-label="1,240 points" />
          ))}
          <PointsChip value={50} prefix="+" aria-label="Plus 50 points earned" />
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="money"
        title="MoneyAmount"
        description="AUD (cents) and IDR (no minor unit)."
      >
        <GalleryRow label="AUD / IDR">
          <MoneyAmount amountMinor={12495} currency="AUD" />
          <MoneyAmount amountMinor={150000} currency="IDR" locale="id-ID" />
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="channel-avatar"
        title="ChannelAvatar"
        description="An image when one loads, initials otherwise — same colour every time for a given name."
      >
        <GalleryRow label="Image and initials">
          <ChannelAvatar
            name="Bumi Coffee"
            src={placeholderImage("Bumi Coffee", 80, 80)}
            size="lg"
          />
          <ChannelAvatar name="Bumi Coffee" size="lg" />
          <ChannelAvatar name="Snap App" size="md" />
          <ChannelAvatar name="Wardah" size="sm" />
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="media-card"
        title="MediaCard"
        description="16:9 and 9:16, both with progress and a points reward."
      >
        <GalleryRow label="Aspect ratios">
          <div className="w-64">
            <MediaCard
              poster={placeholderImage("weekend-bonus", 640, 360)}
              posterAlt=""
              aspect="16:9"
              title="Weekend bonus: 2x points"
              durationLabel="2:14"
              channel={<ChannelAvatar name="Bumi Coffee" size="sm" />}
              reward={<PointsChip value={100} prefix="+" size="sm" aria-label="Plus 100 points" />}
              progress={0.4}
              progressLabel="40% watched"
              href="#"
            />
          </div>
          <div className="w-40">
            <MediaCard
              poster={placeholderImage("try-the-new-menu", 360, 640)}
              posterAlt=""
              aspect="9:16"
              title="Try the new menu"
              durationLabel="0:48"
              channel={<ChannelAvatar name="Snap App" size="sm" />}
              reward={<PointsChip value={25} prefix="+" size="sm" aria-label="Plus 25 points" />}
              progress={0.75}
              progressLabel="75% watched"
              onClick={() => undefined}
            />
          </div>
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="qr-panel"
        title="QRPanel"
        description="A code panel that stays light-on-dark for scanners regardless of theme."
      >
        <GalleryRow label="Redemption code">
          <QRPanel
            src={qrSrc}
            alt="QR code to redeem this reward in the Snap App till"
            code="AB12-CD34"
            caption="Show this at checkout"
          />
        </GalleryRow>
      </GallerySection>
    </>
  );
}
