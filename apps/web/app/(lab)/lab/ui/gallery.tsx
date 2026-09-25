"use client";

import { useState } from "react";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@yourtal/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@yourtal/ui/dialog";
import { Input } from "@yourtal/ui/input";
import { Progress } from "@yourtal/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@yourtal/ui/select";
import { Skeleton } from "@yourtal/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@yourtal/ui/tabs";
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@yourtal/ui/toast";

const BUTTONS = ["default", "secondary", "outline", "ghost", "destructive"] as const;
const BADGES = [
  "default",
  "secondary",
  "success",
  "warning",
  "danger",
  "reward",
  "outline",
] as const;

/** Every primitive on one page, for the rendered gate and the visual baselines. */
export function Gallery() {
  const [toastOpen, setToastOpen] = useState(false);
  return (
    <ToastProvider>
      <main className="mx-auto flex max-w-3xl flex-col gap-8 p-4">
        <h1 className="text-2xl font-bold">Primitives</h1>

        <section aria-labelledby="buttons" className="flex flex-wrap gap-2">
          <h2 id="buttons" className="w-full text-lg font-semibold">
            Buttons
          </h2>
          {BUTTONS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button size="sm">small</Button>
          <Button size="lg">large</Button>
          <Button disabled>disabled</Button>
        </section>

        <section aria-labelledby="badges" className="flex flex-wrap gap-2">
          <h2 id="badges" className="w-full text-lg font-semibold">
            Badges
          </h2>
          {BADGES.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </section>

        <section aria-labelledby="forms" className="flex flex-col gap-3">
          <h2 id="forms" className="text-lg font-semibold">
            Form controls
          </h2>
          <Input label="Email" type="email" placeholder="you@example.com" />
          <Input label="Code" helpText="Six digits" errorMessage="That code has expired" />
          <Select defaultValue="marketer">
            <SelectTrigger aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="marketer">Marketer</SelectItem>
              <SelectItem value="finance">Finance</SelectItem>
            </SelectContent>
          </Select>
          <Progress value={40} aria-label="Watched" />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Card</CardTitle>
            <CardDescription>Surface, border and muted text.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>

        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">One</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
          </TabsList>
          <TabsContent value="one">First panel</TabsContent>
          <TabsContent value="two">Second panel</TabsContent>
        </Tabs>

        <section aria-labelledby="overlays" className="flex flex-wrap gap-2">
          <h2 id="overlays" className="w-full text-lg font-semibold">
            Overlays
          </h2>
          <Dialog>
            <DialogTrigger asChild>
              <Button>Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite a team member</DialogTitle>
                <DialogDescription>They can accept once the invite arrives.</DialogDescription>
              </DialogHeader>
              <Input label="Email" type="email" />
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="secondary" onClick={() => setToastOpen(true)}>
            Show toast
          </Button>
        </section>
      </main>
      <Toast open={toastOpen} onOpenChange={setToastOpen}>
        <ToastTitle>Saved</ToastTitle>
        <ToastDescription>Your changes are in.</ToastDescription>
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}
