import { SPAMBANK_QUEUES } from "@yourtal/contracts/spambank/events";
import {
  runBlocklistCheck,
  systemDnsLookup,
} from "../../../api/src/modules/spambank/autoreply/blocklist";
import { pause, pausedAlertText } from "../../../api/src/modules/spambank/autoreply/pause";
import { defineJob } from "../job";
import { loadSpambankConfig, spambankAlerter, spambankPool } from "../spambank-runtime";

/**
 * The daily blocklist check (BUILD.md §4.6, D2 6) at 02:00 UTC; on demand with
 * `node worker/dist/main.js --spambank-blocklist`. A listing pauses the replies and alerts; a refused
 * lookup (Spamhaus and public resolvers, U14) alerts once a day.
 */
export const job = defineJob({
  queue: SPAMBANK_QUEUES.blocklist,
  schedule: "0 2 * * *",
  async handle(_queued, { config }) {
    await checkBlocklists(spambankPool(config));
  },
});

export async function checkBlocklists(
  db: Parameters<typeof runBlocklistCheck>[0]["db"],
): Promise<Awaited<ReturnType<typeof runBlocklistCheck>>> {
  const settings = loadSpambankConfig();
  const now = new Date();
  const run = await runBlocklistCheck({
    db,
    lookup: systemDnsLookup(),
    ips: settings.blocklist.ips,
    domains: settings.blocklist.domains,
    now,
  });
  const alerter = spambankAlerter();
  if (run.listed.length > 0) {
    const reason = `blocklisted: ${run.listed.map((row) => `${row.target} on ${row.list}`).join(", ")}`;
    if (await pause(db, reason, now))
      await alerter.alert("auto-reply paused", pausedAlertText(reason));
  }
  if (run.newlyRefused) {
    await alerter.alert(
      "blocklist check not possible",
      "Spamhaus refused the lookup from this server's resolver (127.255.255.x). The daily blocklist check " +
        "cannot see Spamhaus listings until the server uses its own resolver or Spamhaus DQS (BUILD.md U14).",
    );
  }
  console.error(
    `[spambank] blocklist: ${run.rows.map((row) => `${row.target}@${row.list}=${row.result}`).join(" ")}`,
  );
  return run;
}
