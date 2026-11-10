"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Heading } from "@yourtal/ui/heading";
import { Input } from "@yourtal/ui/input";
import { KeyValue } from "@yourtal/ui/key-value";
import { formatMoneyAmount } from "@yourtal/ui/money-amount";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { Textarea } from "@yourtal/ui/textarea";
import type { ListingPriceRow, ListingPricesScreen } from "@yourtal/contracts/staff/economy";
import {
  decideListingPriceAction,
  proposeListingPriceAction,
  type ListingPriceActionResult,
} from "./staff-listing-prices-actions";

export interface StaffListingPricesScreenProps {
  readonly region: "AU" | "ID";
  readonly screen: ListingPricesScreen;
  readonly currentStaffId: string;
}

type Flash = { tone: "success" | "danger"; text: string } | null;
type Settle = (result: ListingPriceActionResult, success: string) => boolean;

/**
 * 2.8.g: a listing's staff-set points price. A buyer pays the larger of it
 * and the ledger's quote, so a price below the quote has no effect; the screen
 * says so next to the field and on the listing. Two-person, finance only.
 */
export function StaffListingPricesScreen({
  region,
  screen,
  currentStaffId,
}: StaffListingPricesScreenProps) {
  const t = useTranslations("staff");
  const router = useRouter();
  const [flash, setFlash] = useState<Flash>(null);

  const settle: Settle = (result, success) => {
    if (result.ok) {
      setFlash({ tone: "success", text: success });
      router.refresh();
      return true;
    }
    setFlash({
      tone: "danger",
      text: result.message === "" ? t("listingPrices.formInvalid") : result.message,
    });
    return false;
  };

  return (
    <div className="flex flex-col gap-6">
      <Text tone="muted">{t("listingPrices.explainer")}</Text>
      {flash === null ? null : <Notice tone={flash.tone}>{flash.text}</Notice>}

      <form
        method="get"
        action="/staff/economy/listing-prices"
        role="search"
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="region" value={region} />
        <Input
          name="q"
          label={t("listingPrices.searchLabel")}
          helpText={t("listingPrices.searchHelp")}
          defaultValue={screen.query ?? ""}
          wrapperClassName="w-full max-w-sm"
        />
        <Button type="submit" variant="secondary">
          {t("listingPrices.searchSubmit")}
        </Button>
      </form>

      <Heading level={2} size="title">
        {screen.query === null
          ? t("listingPrices.pricedTitle")
          : t("listingPrices.resultsTitle", { query: screen.query })}
      </Heading>
      {screen.rows.length === 0 ? (
        <EmptyState
          title={
            screen.query === null
              ? t("listingPrices.pricedEmptyTitle")
              : t("listingPrices.resultsEmptyTitle")
          }
        />
      ) : (
        screen.rows.map((row) => (
          <ListingPriceCard
            key={row.listingId}
            region={region}
            row={row}
            currentStaffId={currentStaffId}
            settle={settle}
          />
        ))
      )}
    </div>
  );
}

function ListingPriceCard({
  region,
  row,
  currentStaffId,
  settle,
}: {
  readonly region: "AU" | "ID";
  readonly row: ListingPriceRow;
  readonly currentStaffId: string;
  readonly settle: Settle;
}) {
  const t = useTranslations("staff");
  const format = useFormatter();
  const locale = useLocale();
  const points = (count: number | null): string =>
    count === null ? t("listingPrices.quoteUnavailable") : t("listingPrices.points", { count });
  const quoteWins =
    row.minPricePoints !== null &&
    row.ledgerPricePoints !== null &&
    row.minPricePoints < row.ledgerPricePoints;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">{row.title}</CardTitle>
        <Text size="body-sm" tone="muted">
          {t("listingPrices.byline", {
            merchant: row.merchantName,
            face: formatMoneyAmount(row.faceValueMinor, row.currency, locale),
          })}
          {row.redeemPartnerId === null
            ? null
            : ` · ${t("listingPrices.boundTo", { partner: row.redeemPartnerId })}`}
        </Text>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <KeyValue
          items={[
            {
              key: "quote",
              label: t("listingPrices.ledgerQuote"),
              value: points(row.ledgerPricePoints),
            },
            {
              key: "staff",
              label: t("listingPrices.staffPrice"),
              value:
                row.minPricePoints === null
                  ? t("listingPrices.noStaffPrice")
                  : points(row.minPricePoints),
            },
            {
              key: "pays",
              label: t("listingPrices.buyerPays"),
              value: <strong>{points(row.effectivePricePoints)}</strong>,
            },
          ]}
        />
        {quoteWins ? (
          <Notice tone="warning">
            {t("listingPrices.quoteWinsNow", { quote: format.number(row.ledgerPricePoints ?? 0) })}
          </Notice>
        ) : null}
        {row.pending === null ? (
          <ProposeForm region={region} row={row} settle={settle} />
        ) : (
          <PendingProposal
            region={region}
            row={row}
            pending={row.pending}
            currentStaffId={currentStaffId}
            settle={settle}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PendingProposal({
  region,
  row,
  pending,
  currentStaffId,
  settle,
}: {
  readonly region: "AU" | "ID";
  readonly row: ListingPriceRow;
  readonly pending: NonNullable<ListingPriceRow["pending"]>;
  readonly currentStaffId: string;
  readonly settle: Settle;
}) {
  const t = useTranslations("staff");
  const [isPending, startTransition] = useTransition();
  const staff = pending.proposal.proposedByEmail ?? t("economy.staffUnknown");
  const mine = pending.proposal.proposedBy === currentStaffId;

  function decide(decision: "approve" | "reject") {
    startTransition(() => {
      void decideListingPriceAction(region, pending.proposal.id, decision).then((result) =>
        settle(
          result,
          decision === "approve"
            ? t("listingPrices.flash.approved")
            : t("listingPrices.flash.rejected"),
        ),
      );
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 rounded-control bg-surface-sunken p-3">
      <Text size="body-sm">
        {pending.minPricePoints === null
          ? t("listingPrices.pendingClear", { staff })
          : t("listingPrices.pendingSet", { staff, count: pending.minPricePoints })}
      </Text>
      {pending.proposal.reason === null ? null : (
        <Text size="body-sm" tone="muted">
          {t("listingPrices.pendingReason", { reason: pending.proposal.reason })}
        </Text>
      )}
      {mine ? (
        <Text size="body-sm" tone="muted">
          {t("economy.awaitingSecondApprover")}
        </Text>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {mine ? null : (
          <Button
            size="sm"
            disabled={isPending}
            aria-label={t("listingPrices.approveFor", { title: row.title })}
            onClick={() => decide("approve")}
          >
            {t("listingPrices.approve")}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending}
          aria-label={t(mine ? "listingPrices.withdrawFor" : "listingPrices.declineFor", {
            title: row.title,
          })}
          onClick={() => decide("reject")}
        >
          {mine ? t("listingPrices.withdraw") : t("listingPrices.decline")}
        </Button>
      </div>
    </div>
  );
}

function ProposeForm({
  region,
  row,
  settle,
}: {
  readonly region: "AU" | "ID";
  readonly row: ListingPriceRow;
  readonly settle: Settle;
}) {
  const t = useTranslations("staff");
  const format = useFormatter();
  const id = useId();
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const typed = Number(price);
  const belowQuote =
    price !== "" &&
    Number.isInteger(typed) &&
    typed >= 1 &&
    row.ledgerPricePoints !== null &&
    typed < row.ledgerPricePoints;

  function send(minPricePoints: number | null) {
    startTransition(() => {
      void proposeListingPriceAction(region, row.listingId, minPricePoints, reason).then(
        (result) => {
          if (settle(result, t("listingPrices.flash.proposed"))) {
            setPrice("");
            setReason("");
          }
        },
      );
    });
  }

  return (
    <form
      className="flex flex-col gap-3"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        send(typed);
      }}
    >
      <Text id={`${id}-title`} size="body-sm" className="font-medium">
        {t("listingPrices.proposeTitle")}
      </Text>
      <Input
        type="number"
        name="minPricePoints"
        label={t("listingPrices.newPriceLabel")}
        {...(row.ledgerPricePoints === null
          ? {}
          : {
              helpText: t("listingPrices.newPriceHelp", {
                quote: format.number(row.ledgerPricePoints),
              }),
            })}
        min={1}
        step={1}
        required
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        wrapperClassName="w-full max-w-xs"
      />
      {belowQuote ? (
        <Notice tone="warning">
          {t("listingPrices.belowQuoteWarning", {
            quote: format.number(row.ledgerPricePoints ?? 0),
          })}
        </Notice>
      ) : null}
      <Textarea
        name="reason"
        label={t("listingPrices.reasonLabel")}
        required
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending} className="w-fit">
          {t("listingPrices.proposeSubmit")}
        </Button>
        {row.minPricePoints === null ? null : (
          <Button
            type="button"
            variant="secondary"
            disabled={isPending || reason.trim() === ""}
            onClick={() => send(null)}
          >
            {t("listingPrices.proposeClear")}
          </Button>
        )}
      </div>
    </form>
  );
}
