"use client";

import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { VerticalFeed } from "@yourtal/ui/vertical-feed";
import { VerticalFeedVideo } from "@yourtal/ui/vertical-feed/video";
import type { PublicFeedTeaserViewItem } from "./public-feed-view";

export interface PublicFeedTeaserProps {
  items: readonly PublicFeedTeaserViewItem[];
  landmarkLabel: string;
  endHeading: string;
  playLabel: string;
  pauseLabel: string;
  signUpHref: string;
  signUpCta: string;
}

/**
 * 11.1.b: the logged-out "For You" feed of Open Viewing teasers on `/au`
 * and `/id` — the same `VerticalFeed`/`VerticalFeedVideo` primitives (3.5.a)
 * the signed-in Home feed (11.4) uses, in the anonymous mode Cerbos's
 * `campaign_view.yaml` actually allows: muted, looping, inline playback
 * only. There is no earn moment here — `anonymous-can-never-earn` denies
 * `earn`/`answer_scored` outright — so every card's one action is the sign
 * up CTA, never a tap-to-earn control.
 *
 * A Client Component leaf under an otherwise server-rendered, ISR page
 * (`app/(public)/[locale]/page.tsx`): the data fetch and every string here
 * are resolved server-side (`public-feed-view.ts`) and passed down as
 * plain, serialisable props, so the page itself stays static/ISR — only
 * the video/scroll interactivity needs the client boundary.
 */
export function PublicFeedTeaser({
  items,
  landmarkLabel,
  endHeading,
  playLabel,
  pauseLabel,
  signUpHref,
  signUpCta,
}: PublicFeedTeaserProps) {
  return (
    <VerticalFeed
      items={items}
      mode="teaser"
      label={landmarkLabel}
      endSlot={
        <div className="flex flex-col items-center gap-2 p-6 text-center">
          <p className="text-title font-sans font-semibold text-fg">{endHeading}</p>
        </div>
      }
      renderItem={(item, state) => (
        <div className="relative h-full w-full">
          <VerticalFeedVideo
            mounted={state.mounted}
            active={state.active}
            src={item.teaser}
            poster={item.poster}
            posterAlt={item.title}
            label={item.title}
            playLabel={`${playLabel} — ${item.title}`}
            pauseLabel={`${pauseLabel} — ${item.title}`}
            loop
          />
          <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center gap-2">
            <ChannelAvatar name={item.merchantName} size="sm" />
            <span className="line-clamp-1 text-body-sm font-sans font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0_/_0.6)]">
              {item.merchantName}
            </span>
          </div>
          <div className="pointer-events-auto absolute inset-x-3 bottom-3 flex flex-col gap-2">
            <span className="line-clamp-2 font-display text-title font-bold text-balance text-white [text-shadow:0_1px_3px_rgb(0_0_0_/_0.7)]">
              {item.title}
            </span>
            <span className="text-body-sm text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0_/_0.6)]">
              {item.termsLabel}
            </span>
            <a
              href={signUpHref}
              className="inline-flex h-9 w-fit items-center justify-center rounded-pill bg-accent px-4 text-label font-sans font-bold text-fg-on-accent"
            >
              {signUpCta}
            </a>
          </div>
        </div>
      )}
    />
  );
}
