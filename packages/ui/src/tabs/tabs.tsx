"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../cn";

export const Tabs = TabsPrimitive.Root;

export type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-control-compact items-center gap-1 rounded-control border border-border-subtle bg-surface-sunken p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>;

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-8 items-center justify-center rounded-control px-3 text-label font-sans text-fg-muted",
      "transition-colors duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-1",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export type TabsContentProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  TabsContentProps
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
