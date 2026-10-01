"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/** 13.9.e: the viewer's own choice, kept in this browser. */
export const CAPTIONS_STORAGE_KEY = "yourtal:captions";

export type CaptionsChoice = "on" | "off";

export function readStoredCaptions(): CaptionsChoice | null {
  try {
    const value = window.localStorage.getItem(CAPTIONS_STORAGE_KEY);
    return value === "on" || value === "off" ? value : null;
  } catch {
    return null;
  }
}

function storeCaptions(choice: CaptionsChoice): void {
  try {
    window.localStorage.setItem(CAPTIONS_STORAGE_KEY, choice);
  } catch {
    // Private mode or storage blocked: the toggle still works for this page.
  }
}

/**
 * 13.9.e: captions on or off for a player's first text track. A choice the
 * viewer made before wins; with none, the OS caption setting does, which
 * browsers apply by already showing the track when it loads.
 */
export function useCaptions(videoRef: RefObject<HTMLVideoElement | null>, hasTrack: boolean) {
  const [on, setOn] = useState(false);

  // Resolve the starting state after mount, once the track exists.
  useEffect(() => {
    if (!hasTrack) return;
    const video = videoRef.current;
    if (!video) return;
    const track = video.textTracks[0];
    if (!track) return;
    const stored = readStoredCaptions();
    const initial = stored === null ? track.mode === "showing" : stored === "on";
    track.mode = initial ? "showing" : "hidden";
    setOn(initial);
    // The OS setting can also arrive once the track finishes loading.
    const onChange = () => {
      if (readStoredCaptions() === null) setOn(track.mode === "showing");
    };
    const tracks = video.textTracks;
    tracks.addEventListener("change", onChange);
    return () => tracks.removeEventListener("change", onChange);
  }, [hasTrack, videoRef]);

  const toggle = useCallback(() => {
    const track = videoRef.current?.textTracks[0];
    setOn((current) => {
      const next = !current;
      if (track) track.mode = next ? "showing" : "hidden";
      storeCaptions(next ? "on" : "off");
      return next;
    });
  }, [videoRef]);

  return { on, toggle };
}
