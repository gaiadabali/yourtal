"use client";

import { ChevronLeft, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { ChannelAvatar, PointsChip } from "./bits";
import { UNLOCKS_ON, type Campaign } from "./lab-data";
import { LabVideo } from "./lab-video";
import { useProto } from "./proto-context";
import { QuestionSheet } from "./question-sheet";

type Stage = "watching" | "question" | "done";

/** The long-form player: one question mid-video, then the earn moment. Never autoplays on. */
export function Player({ campaign, onBack }: { campaign: Campaign; onBack: () => void }) {
  const { variant, earn, muted, setMuted } = useProto();
  const [stage, setStage] = useState<Stage>("watching");
  const [asked, setAsked] = useState(false);
  const [correct, setCorrect] = useState(false);
  const [progress, setProgress] = useState({ t: 0, d: 0 });
  const chip = useRef<HTMLSpanElement | null>(null);
  const immersive = variant === "after-dark";
  const earnedPts = campaign.rewardPts + (correct ? campaign.bonusPts : 0);

  const onTime = (t: number, d: number) => {
    setProgress({ t, d });
    if (!asked && t >= campaign.questionAt) {
      setAsked(true);
      setStage("question");
    }
  };

  const onEnded = () => {
    if (stage === "done") return;
    setStage("done");
    earn(earnedPts, chip.current);
  };

  const pct = progress.d ? (progress.t / progress.d) * 100 : 0;
  const markerPct = progress.d ? (campaign.questionAt / progress.d) * 100 : 30;
  const vertical = campaign.orientation === "vertical";

  return (
    <div className={`relative flex h-full flex-col ${immersive ? "bg-black text-white" : ""}`}>
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to feed"
          className="flex size-11 items-center justify-center rounded-full hover:bg-(--lab-surface-2)"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <span className="truncate text-sm font-semibold">{campaign.channel.name}</span>
        <button
          type="button"
          aria-label={muted ? "Turn sound on" : "Turn sound off"}
          onClick={() => setMuted(!muted)}
          className="ml-auto flex size-11 items-center justify-center rounded-full hover:bg-(--lab-surface-2)"
        >
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
      </div>

      <LabVideo
        clip={campaign.clip}
        active
        hold={stage !== "watching"}
        label={`${campaign.channel.name}: ${campaign.title}`}
        fit={vertical ? "contain" : "cover"}
        className={vertical ? "h-[52dvh] w-full" : "aspect-video w-full"}
        onTime={onTime}
        onEnded={onEnded}
      />
      <div
        className="relative h-1 bg-white/25"
        role="progressbar"
        aria-label="Watched"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className="h-full bg-(--lab-accent)" style={{ width: `${pct}%` }} />
        <span
          aria-hidden="true"
          className="absolute -top-1 size-3 -translate-x-1/2 rounded-full border-2 border-black bg-(--lab-points)"
          style={{ left: `${markerPct}%` }}
        />
      </div>

      <div className={`flex flex-col gap-4 p-4 ${immersive ? "" : "bg-(--lab-canvas)"}`}>
        <h1 className="font-(family-name:--lab-display) text-2xl leading-tight font-extrabold text-balance">
          {campaign.title}
        </h1>
        <div className="flex items-center gap-3">
          <ChannelAvatar channel={campaign.channel} size={36} />
          <span className="font-semibold">{campaign.channel.name}</span>
        </div>
        <div
          className={`flex items-center justify-between gap-3 rounded-2xl p-4 ${immersive ? "bg-white/10" : "bg-(--lab-surface)"}`}
        >
          {stage === "done" ? (
            <p role="status" className="font-semibold">
              Nice work. Your points unlock on {UNLOCKS_ON}.
            </p>
          ) : (
            <p className={immersive ? "text-white/85" : "text-(--lab-fg-muted)"}>
              Watch to the end and answer one question. {campaign.durationLabel}
            </p>
          )}
          <span ref={chip} className="shrink-0">
            <PointsChip
              value={stage === "done" ? earnedPts : campaign.rewardPts + campaign.bonusPts}
              prefix={stage === "done" ? "+" : "up to "}
            />
          </span>
        </div>
        {stage === "done" ? (
          <button
            type="button"
            onClick={onBack}
            className="h-12 rounded-full bg-(--lab-accent) font-bold text-(--lab-fg-on-accent)"
          >
            Back to the feed
          </button>
        ) : null}
      </div>

      {stage === "question" ? (
        <div className={immersive ? "text-(--lab-fg)" : ""}>
          <QuestionSheet
            question={campaign.question}
            onDone={(ok) => {
              setCorrect(ok);
              setStage("watching");
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
