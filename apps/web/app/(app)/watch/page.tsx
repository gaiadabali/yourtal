import { redirect } from "next/navigation";

// The long-video grid is Home now (13.13.c); `/watch/[campaignId]` stays.
export default function WatchPage(): never {
  redirect("/home");
}
