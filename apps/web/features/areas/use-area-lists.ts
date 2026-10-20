"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AreaPlacesResponse, AreaStatesResponse } from "@yourtal/contracts/areas/schema";
import { fetchAreaPlacesAction, fetchAreaStatesAction } from "./area-actions";

export type Loadable<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly data: T };

/** The area list a picker shows: the states first, then one state's suburbs once it is opened. */
export function useAreaLists(stateCode: string | null) {
  const [states, setStates] = useState<Loadable<AreaStatesResponse["states"]>>({
    kind: "loading",
  });
  // Keyed by state, so opening another state shows "loading", never the last one's suburbs.
  const [places, setPlaces] = useState<{
    readonly code: string;
    readonly value: Loadable<AreaPlacesResponse["places"]>;
  } | null>(null);
  const cache = useRef(new Map<string, AreaPlacesResponse["places"]>());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void fetchAreaStatesAction().then((result) => {
      if (!live) return;
      setStates(result.ok ? { kind: "ready", data: result.data.states } : { kind: "error" });
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (stateCode === null) return;
    const cached = cache.current.get(stateCode);
    let live = true;
    void (
      cached !== undefined
        ? Promise.resolve({ ok: true as const, places: cached })
        : fetchAreaPlacesAction(stateCode).then((result) =>
            result.ok ? { ok: true as const, places: result.data.places } : { ok: false as const },
          )
    ).then((result) => {
      if (!live) return;
      if (result.ok) {
        cache.current.set(stateCode, result.places);
        setPlaces({ code: stateCode, value: { kind: "ready", data: result.places } });
      } else {
        setPlaces({ code: stateCode, value: { kind: "error" } });
      }
    });
    return () => {
      live = false;
    };
  }, [stateCode, attempt]);

  const retry = useCallback(() => {
    setStates({ kind: "loading" });
    setPlaces(null);
    setAttempt((count) => count + 1);
  }, []);

  const placesForState: Loadable<AreaPlacesResponse["places"]> | null =
    stateCode === null ? null : places?.code === stateCode ? places.value : { kind: "loading" };
  return { states, places: placesForState, retry };
}
