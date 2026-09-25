"use client";

import { Play } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { media } from "./lab-data";
import { useProto } from "./proto-context";

export interface LabVideoProps {
  clip: string;
  /** Only the active item plays; the rest sit on their poster. */
  active: boolean;
  label: string;
  fit?: "cover" | "contain";
  loop?: boolean;
  /** Suspends playback without losing the viewer's pause choice (a question is open). */
  hold?: boolean;
  /** Lift captions clear of UI laid over the bottom of the video. */
  captionsTop?: boolean;
  onTime?: (seconds: number, duration: number) => void;
  onEnded?: () => void;
  className?: string;
}

/**
 * Tap pauses and resumes. Captions are on whenever the sound is off. Under reduced
 * motion nothing autoplays: the viewer presses play.
 */
export const LabVideo = forwardRef<HTMLVideoElement | null, LabVideoProps>(function LabVideo(
  {
    clip,
    active,
    label,
    fit = "cover",
    loop = false,
    hold = false,
    captionsTop = false,
    onTime,
    onEnded,
    className,
  },
  ref,
) {
  const { muted, reducedMotion } = useProto();
  const video = useRef<HTMLVideoElement | null>(null);
  const track = useRef<HTMLTrackElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  useImperativeHandle(ref, () => video.current as HTMLVideoElement);

  const wantsPlay = active && !hold && !paused && (started || !reducedMotion);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (wantsPlay) void el.play().catch(() => setPaused(true));
    else el.pause();
  }, [wantsPlay]);

  useEffect(() => {
    if (!active) {
      setPaused(false);
      setStarted(false);
    }
  }, [active]);

  useEffect(() => {
    const captions = video.current?.textTracks[0];
    if (captions) captions.mode = muted ? "showing" : "hidden";
  }, [muted, active]);

  useEffect(() => {
    const el = track.current;
    if (!el || !captionsTop) return;
    const place = () => {
      for (const cue of Array.from(el.track.cues ?? [])) {
        (cue as VTTCue).snapToLines = false;
        (cue as VTTCue).line = 14;
      }
    };
    place();
    el.addEventListener("load", place);
    return () => el.removeEventListener("load", place);
  }, [captionsTop]);

  const toggle = () => {
    setStarted(true);
    setPaused((p) => (reducedMotion && !started ? false : !p));
  };

  return (
    <div className={`relative overflow-hidden bg-black ${className ?? ""}`}>
      {fit === "contain" ? (
        <img
          src={media(clip, "jpg")}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl"
        />
      ) : null}
      <video
        ref={video}
        src={media(clip, "mp4")}
        poster={media(clip, "jpg")}
        muted={muted}
        playsInline
        loop={loop}
        preload={active ? "auto" : "none"}
        aria-label={label}
        className={`relative h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
        onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime, e.currentTarget.duration)}
        onEnded={onEnded}
      >
        <track
          ref={track}
          kind="captions"
          srcLang="en"
          label="English"
          src={media(clip, "vtt")}
          default
        />
      </video>
      <button
        type="button"
        onClick={toggle}
        aria-label={wantsPlay ? "Pause" : "Play"}
        className="absolute inset-0 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-white"
      >
        {!wantsPlay && active && !hold ? (
          <span className="flex size-16 items-center justify-center rounded-full bg-black/55 text-white">
            <Play size={30} aria-hidden="true" className="translate-x-0.5 fill-white" />
          </span>
        ) : null}
      </button>
    </div>
  );
});
