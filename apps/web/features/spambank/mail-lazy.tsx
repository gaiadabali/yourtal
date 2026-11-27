"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { MailRoute } from "./mail-routes";
import { ListSkeleton } from "./mail-ui";

/**
 * The mail screens and the engine behind them load after the page, not with it. Everything inside
 * is fetched in the browser anyway (the list, the message, the token), so there is nothing to
 * render on the server, and the first-load JS of `/mail` stays within the budget.
 */
const Frame = dynamic(() => import("./mail-frame"), {
  ssr: false,
  loading: () => <ListSkeleton rows={8} />,
});
const Routes = dynamic(() => import("./mail-routes-view").then((m) => m.MailRoutesView), {
  ssr: false,
  loading: () => <ListSkeleton rows={8} />,
});

if (typeof window !== "undefined") {
  // Start both downloads together; the second would otherwise wait for the first to render.
  void import("./mail-frame");
  void import("./mail-routes-view");
}

export function LazyMailFrame({ address, children }: { address: string; children: ReactNode }) {
  return <Frame address={address}>{children}</Frame>;
}

export function LazyMailRoutes({ route }: { route: MailRoute }) {
  return <Routes route={route} />;
}
