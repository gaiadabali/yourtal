"use client";

import type { MailRoute } from "./mail-routes";
import { Compose } from "./compose";
import { MessageList } from "./message-list";
import { Reader } from "./reader";

/** Which screen a resolved URL shows. The real route and the lab preview both render this. */
export function MailRoutesView({ route }: { route: MailRoute }) {
  switch (route.view) {
    case "folder":
      return <MessageList folder={route.folder} />;
    case "search":
      return <MessageList search={route.q} />;
    case "message":
      return <Reader id={route.id} />;
    case "compose":
      return <Compose mode={route.mode} id={route.id} />;
  }
}
