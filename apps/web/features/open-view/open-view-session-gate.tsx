"use client";

import { useEffect, useState } from "react";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { PlayerChapter } from "@/features/player/player-chapters";
import type { SupportedLocale } from "@/features/player/player-i18n";
import { OpenViewPlayer } from "./open-view-player";
import { OpenViewSignupPrompt } from "./open-view-signup-prompt";
import { buildOpenViewSignupHref } from "./open-view-signup-href";
import { startOpenViewSession } from "./open-view-session-client";
import type { OpenViewCopy } from "./open-view-copy";

export interface OpenViewSessionGateProps {
  campaign: Campaign;
  chapters: readonly PlayerChapter[];
  copy: OpenViewCopy;
  locale: SupportedLocale;
}

type GateState =
  | { kind: "starting" }
  | { kind: "ready"; sessionId: string; campaign: Campaign }
  | { kind: "denied"; status: number; message: string | null };

/**
 * 11.2.b: mints this visitor's anonymous, non-earning watch session BEFORE
 * any video element mounts, and swaps the campaign's manifest for the
 * per-session SIGNED one the session returns — `OpenViewPlayer` (and, through
 * it, `features/player/use-watch-session.ts`) never sees the campaign's own
 * raw `hlsUrl`/`videoSource.manifestUrl` at all, only this substituted copy.
 * That is what keeps `/media/hls/` from ever becoming reachable through this
 * path without a session behind it.
 *
 * Starts eagerly on mount rather than behind an extra tap — this route is
 * only ever reached by clicking through from the campaign page's "watch
 * without signing up" link, which is already the deliberate, less-prominent
 * action (`public-campaign-content.tsx`), so a second confirmation here
 * would just be friction. It does mean the F12 one-concurrent-session slot
 * is claimed on page load rather than on first play, which is the same
 * trade a page that starts loading its hero video before a click already
 * makes everywhere else in this app.
 */
export function OpenViewSessionGate({
  campaign,
  chapters,
  copy,
  locale,
}: OpenViewSessionGateProps) {
  const [state, setState] = useState<GateState>({ kind: "starting" });
  const signupHref = buildOpenViewSignupHref(campaign.id);

  useEffect(() => {
    let cancelled = false;
    void startOpenViewSession(campaign.id).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({ kind: "denied", status: result.status, message: result.message });
        return;
      }
      setState({
        kind: "ready",
        sessionId: result.sessionId,
        campaign: {
          ...campaign,
          hlsUrl: result.manifestUrl,
          videoSource: { kind: "hls", manifestUrl: result.manifestUrl },
        },
      });
    });
    return () => {
      cancelled = true;
    };
    // campaign.id is the only input this session depends on; a re-render
    // with the same campaign must not mint a second session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id]);

  if (state.kind === "starting") {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-fg">
        <img src={campaign.posterUrl} alt="" className="h-full w-full object-cover opacity-60" />
        <p role="status" aria-live="polite" className="sr-only">
          {copy.startingLabel}
        </p>
      </div>
    );
  }

  if (state.kind === "denied") {
    const isDailyLimit = state.status === 403 && (state.message?.includes("today's") ?? false);
    const isConcurrent =
      state.status === 403 && (state.message?.includes("one anonymous") ?? false);
    const heading = isDailyLimit
      ? copy.dailyLimitHeading
      : isConcurrent
        ? copy.concurrentSessionHeading
        : copy.startFailedHeading;
    const body = isDailyLimit
      ? copy.dailyLimitBody
      : isConcurrent
        ? copy.concurrentSessionBody
        : copy.startFailedBody;
    return (
      <div className="flex flex-col gap-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-fg">
          <img src={campaign.posterUrl} alt="" className="h-full w-full object-cover opacity-40" />
        </div>
        <OpenViewSignupPrompt
          heading={heading}
          body={body}
          signupHref={signupHref}
          signupCta={copy.signupCta}
        />
      </div>
    );
  }

  return (
    <OpenViewPlayer
      campaign={state.campaign}
      chapters={chapters}
      copy={copy}
      locale={locale}
      sessionId={state.sessionId}
    />
  );
}
