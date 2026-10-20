"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AreaPlacesResponse } from "@yourtal/contracts/areas/schema";
import { Button } from "@yourtal/ui/button";
import { Chip } from "@yourtal/ui/chip";
import { Input } from "@yourtal/ui/input";
import { Skeleton } from "@yourtal/ui/skeleton";
import { Text } from "@yourtal/ui/text";
import { areaLetter } from "./area-label";
import { useAreaLists } from "./use-area-lists";

type Place = AreaPlacesResponse["places"][number];

/** A typed filter shows at most this many suburbs, so a state-wide match never becomes thousands of buttons. */
const MAX_SHOWN = 100;

export interface AreaPickerProps {
  /** The person picked a suburb; `postcode` is what is stored. */
  onPick: (place: Place) => void;
  /** Postcodes already chosen (Studio picks several); their suburbs read "Added" and stay put. */
  chosen?: readonly string[];
  disabled?: boolean;
}

/**
 * F116: pick an area by state, then suburb, never by typing a postcode. The
 * states are always visible; the suburbs of the chosen state are a scrollable
 * list grouped by first letter, with a name filter as an extra. A suburb that
 * has more than one postcode in its state shows which one each is.
 */
export function AreaPicker({ onPick, chosen = [], disabled }: AreaPickerProps) {
  const t = useTranslations("areas");
  const [stateCode, setStateCode] = useState<string | null>(null);
  const [letterChoice, setLetterChoice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { states, places, retry } = useAreaLists(stateCode);

  const needle = query.trim().toLocaleLowerCase("en-AU");
  const ready = places?.kind === "ready" ? places.data : null;
  const letters = useMemo(
    () => [...new Set((ready ?? []).map((place) => areaLetter(place.name)))],
    [ready],
  );
  const letter =
    letterChoice !== null && letters.includes(letterChoice) ? letterChoice : letters[0];
  const shownAll = useMemo(
    () =>
      (ready ?? []).filter((place) =>
        needle.length > 0
          ? place.name.toLocaleLowerCase("en-AU").includes(needle)
          : areaLetter(place.name) === letter,
      ),
    [ready, needle, letter],
  );
  // Only a typed filter is capped; a letter shows all its suburbs, so every one can be reached.
  const shown = needle.length > 0 ? shownAll.slice(0, MAX_SHOWN) : shownAll;
  const duplicated = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const place of ready ?? []) {
      (seen.has(place.name) ? dupes : seen).add(place.name);
    }
    return dupes;
  }, [ready]);

  if (states.kind === "loading") {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton className="h-control w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (states.kind === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <Text tone="danger">{t("error")}</Text>
        <Button variant="secondary" size="sm" onClick={retry}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  const stateName = states.data.find((state) => state.code === stateCode)?.name ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t("stateLabel")} className="flex flex-wrap gap-1.5">
        {states.data.map((state) => (
          <Chip
            key={state.code}
            pressed={state.code === stateCode}
            disabled={disabled === true}
            onPressedChange={() => {
              setStateCode(state.code);
              setLetterChoice(null);
              setQuery("");
            }}
          >
            {state.name}
          </Chip>
        ))}
      </div>

      {stateCode === null ? (
        <Text tone="muted" size="body-sm">
          {t("chooseState")}
        </Text>
      ) : places?.kind === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <Text tone="danger">{t("error")}</Text>
          <Button variant="secondary" size="sm" onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      ) : ready === null ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">{t("loading")}</span>
          <Skeleton className="h-control w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          <Input
            label={t("filterLabel", { state: stateName })}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            disabled={disabled === true}
          />
          {needle.length === 0 ? (
            <div role="group" aria-label={t("lettersLabel")} className="flex flex-wrap gap-1.5">
              {letters.map((item) => (
                <Chip
                  key={item}
                  pressed={item === letter}
                  disabled={disabled === true}
                  onPressedChange={() => setLetterChoice(item)}
                >
                  {item}
                </Chip>
              ))}
            </div>
          ) : null}
          <div
            role="region"
            aria-label={t("listLabel", { state: stateName })}
            tabIndex={0}
            className="max-h-64 overflow-y-auto rounded-control border border-border-control"
          >
            {shown.length === 0 ? (
              <Text tone="muted" size="body-sm" className="p-3">
                {t("empty", { query: query.trim() })}
              </Text>
            ) : (
              <ul className="divide-y divide-border-control">
                {shown.map((place) => {
                  const added = chosen.includes(place.postcode);
                  return (
                    <li key={`${place.name}-${place.postcode}`}>
                      <button
                        type="button"
                        disabled={disabled === true || added}
                        onClick={() => onPick(place)}
                        className="flex min-h-control w-full items-center justify-between gap-3 px-3 py-2 text-left text-body font-sans text-fg hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span>
                          {place.name}
                          {duplicated.has(place.name) ? (
                            <span className="text-fg-muted"> · {place.postcode}</span>
                          ) : null}
                        </span>
                        {added ? (
                          <span className="text-caption text-fg-muted">{t("added")}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {needle.length > 0 && shownAll.length > MAX_SHOWN ? (
            <Text tone="muted" size="caption">
              {t("moreHint", { count: MAX_SHOWN })}
            </Text>
          ) : null}
        </>
      )}
    </div>
  );
}
