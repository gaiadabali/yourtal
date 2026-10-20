import type { PaySimConfig } from "./config";
import type { PaySimStore } from "./store";
import { runSweep } from "./sweep";
import { deliverDue } from "./webhooks";

export interface DispatcherOptions {
  store: PaySimStore;
  config: PaySimConfig;
  intervalMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Called when a tick throws; the loop keeps going. */
  onError?: (error: unknown) => void;
}

/** One pass: sweep what is due, then deliver what is due. No sleeping. */
export async function runPaySimTick(
  opts: Pick<DispatcherOptions, "store" | "config" | "fetch" | "now">,
): Promise<{ swept: number; delivered: number }> {
  const now = opts.now ?? (() => new Date());
  const swept = await runSweep(opts.store, opts.config, now());
  const delivered = await deliverDue({
    store: opts.store,
    config: opts.config,
    fetch: opts.fetch ?? fetch,
    now,
  });
  return { swept, delivered };
}

/**
 * Delivers due webhooks and runs the sweep on an interval. Safe with more than
 * one process: the Postgres store claims rows with FOR UPDATE SKIP LOCKED.
 */
export function startPaySimDispatcher(opts: DispatcherOptions): { stop(): Promise<void> } {
  const intervalMs = opts.intervalMs ?? 2000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = tick();
    }, intervalMs);
    timer.unref();
  };

  async function tick(): Promise<void> {
    try {
      await runPaySimTick(opts);
    } catch (error) {
      opts.onError?.(error);
    }
    schedule();
  }

  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await running;
    },
  };
}
