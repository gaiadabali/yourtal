"use client";

import { useState } from "react";
import type { SubmitEvent } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@yourtal/ui/tabs";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { MerchantQrScanner } from "./merchant-qr-scanner";
import type { MerchantScannerUnavailableReason } from "./merchant-qr-scanner-camera";
import type { MerchantCopy } from "./merchant-copy";

export interface MerchantIdentifyPanelProps {
  copy: MerchantCopy;
  onSubmitCode: (code: string) => void;
  onScanDetect: (payload: string) => void;
}

type IdentifyTab = "scan" | "manual";

/**
 * Scan and manual entry are both first-class here — two always-visible
 * tabs, never a hidden fallback link (this ticket's brief: "a real QR
 * scanner needs camera permission that may be denied... provide a manual
 * code-entry fallback as a first-class path, not a hidden one"). The
 * camera leaf mounts only while the "Scan" tab is selected — combined with
 * `merchant-qr-scanner.tsx`'s `next/dynamic({ ssr: false })`, its module
 * is not even fetched until staff choose to scan.
 *
 * Any reason the camera can't be used (unsupported browser, denied
 * permission, no camera) switches to the manual tab automatically AND
 * says why, so staff are never left staring at a dead camera preview with
 * no explanation.
 */
export function MerchantIdentifyPanel({
  copy,
  onSubmitCode,
  onScanDetect,
}: MerchantIdentifyPanelProps) {
  const [tab, setTab] = useState<IdentifyTab>("scan");
  const [code, setCode] = useState("");
  const [scanUnavailable, setScanUnavailable] = useState<MerchantScannerUnavailableReason | null>(
    null,
  );

  function handleManualSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed) {
      onSubmitCode(trimmed);
    }
  }

  function handleUnavailable(reason: MerchantScannerUnavailableReason) {
    setScanUnavailable(reason);
    setTab("manual");
  }

  const unavailableMessage =
    scanUnavailable === "permission_denied"
      ? copy.scanPermissionDenied
      : scanUnavailable === "no_camera"
        ? copy.scanNoCamera
        : scanUnavailable === "unsupported"
          ? copy.scanUnavailable
          : null;

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as IdentifyTab)}>
      <TabsList className="grid h-14 w-full grid-cols-2">
        <TabsTrigger value="scan" className="h-12 text-base">
          {copy.tabScan}
        </TabsTrigger>
        <TabsTrigger value="manual" className="h-12 text-base">
          {copy.tabManual}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="scan">
        {unavailableMessage ? (
          <p
            role="alert"
            className="rounded-lg border border-warning bg-warning/10 p-3 text-sm font-sans text-fg"
          >
            {unavailableMessage}
          </p>
        ) : tab === "scan" ? (
          <MerchantQrScanner
            onDetect={onScanDetect}
            onUnavailable={handleUnavailable}
            hint={copy.scanHint}
          />
        ) : null}
      </TabsContent>
      <TabsContent value="manual">
        <form onSubmit={handleManualSubmit} className="flex flex-col gap-3">
          {unavailableMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-warning bg-warning/10 p-3 text-sm font-sans text-fg"
            >
              {unavailableMessage}
            </p>
          ) : null}
          <Input
            label={copy.manualCodeLabel}
            helpText={copy.manualCodeHelp}
            placeholder={copy.manualCodePlaceholder}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            className="h-14 text-xl uppercase tracking-wide"
          />
          <Button type="submit" size="lg" disabled={!code.trim()} className="h-14 text-base">
            {copy.lookUpButton}
          </Button>
        </form>
      </TabsContent>
    </Tabs>
  );
}
