"use client";

import * as React from "react";
import { Button } from "@yourtal/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTarget,
  CardTitle,
} from "@yourtal/ui/card";
import { Heading } from "@yourtal/ui/heading";
import { PageContainer } from "@yourtal/ui/page-container";
import { PageHeader } from "@yourtal/ui/page-header";
import { Section } from "@yourtal/ui/section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@yourtal/ui/tabs";
import { Text } from "@yourtal/ui/text";
import { GalleryRow, GallerySection } from "../lib/gallery-section";

const HEADING_SIZES = ["display-lg", "display", "headline", "title"] as const;
const TEXT_SIZES = ["body", "body-sm", "label", "caption"] as const;
const TEXT_TONES = ["default", "muted", "subtle", "accent", "danger", "success"] as const;
const PAGE_WIDTHS = ["narrow", "default", "wide"] as const;

/** Typography, page/section scaffolding, Card and Tabs — the structural primitives. */
export function LayoutGroup() {
  return (
    <>
      <GallerySection
        id="typography"
        title="Heading and Text"
        description="Every size, independent of document level; every tone."
      >
        <GalleryRow label="Heading sizes (all rendered as h3)">
          <div className="flex flex-col gap-2">
            {HEADING_SIZES.map((size) => (
              <Heading key={size} level={3} size={size}>
                {size}
              </Heading>
            ))}
          </div>
        </GalleryRow>
        <GalleryRow label="Text sizes">
          <div className="flex flex-col gap-1">
            {TEXT_SIZES.map((size) => (
              <Text key={size} size={size}>
                {size} — the quick brown fox
              </Text>
            ))}
          </div>
        </GalleryRow>
        <GalleryRow label="Text tones">
          <div className="flex flex-col gap-1">
            {TEXT_TONES.map((tone) => (
              <Text key={tone} tone={tone}>
                {tone} tone
              </Text>
            ))}
          </div>
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="layout"
        title="PageContainer, PageHeader and Section"
        description="Page scaffolding, at every width tier."
      >
        <GalleryRow label="PageContainer widths">
          <div className="flex w-full flex-col gap-2">
            {PAGE_WIDTHS.map((width) => (
              <PageContainer
                key={width}
                width={width}
                className="border border-dashed border-border-strong py-2"
              >
                <Text size="caption" tone="muted">{`width="${width}"`}</Text>
              </PageContainer>
            ))}
          </div>
        </GalleryRow>
        <GalleryRow label="PageHeader">
          <PageHeader
            title="Campaign performance"
            description="How your active campaigns are tracking this week."
            actions={<Button size="sm">Export report</Button>}
            className="w-full"
          />
        </GalleryRow>
        <GalleryRow label="Section">
          <Section
            title="Trending videos"
            description="Refreshed every hour."
            level={3}
            action={<Button variant="link">See all</Button>}
            className="w-full"
          >
            <Text tone="muted" size="body-sm">
              Section content goes here.
            </Text>
          </Section>
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="cards"
        title="Card"
        description="Plain, interactive (a stretched target) and inset."
      >
        <GalleryRow label="Variants">
          <Card className="w-64">
            <CardHeader>
              <CardTitle>Plain card</CardTitle>
              <CardDescription>Surface, border and a slight lift.</CardDescription>
            </CardHeader>
            <CardContent>
              <Text size="body-sm" tone="muted">
                No interaction — a static container.
              </Text>
            </CardContent>
          </Card>

          <Card variant="interactive" className="w-64">
            <CardHeader>
              <CardTitle>Weekend bonus campaign</CardTitle>
              <CardDescription>2x points on every video, Sat–Sun.</CardDescription>
            </CardHeader>
            <CardTarget onClick={() => undefined}>
              <span className="sr-only">View weekend bonus campaign details</span>
            </CardTarget>
          </Card>

          <Card variant="inset" className="w-64">
            <CardHeader>
              <CardTitle>Inset card</CardTitle>
              <CardDescription>A sunken well inside a larger surface.</CardDescription>
            </CardHeader>
          </Card>
        </GalleryRow>
      </GallerySection>

      <GallerySection
        id="tabs"
        title="Tabs"
        description="Panel switching with roving keyboard focus."
      >
        <Tabs defaultValue="overview" className="w-full max-w-md">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <Text size="body-sm">You have earned 1,240 points this month.</Text>
          </TabsContent>
          <TabsContent value="details">
            <Text size="body-sm">Points breakdown by campaign is available in Wallet.</Text>
          </TabsContent>
        </Tabs>
      </GallerySection>
    </>
  );
}
