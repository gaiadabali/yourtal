/**
 * Narrow, ambient Network Information API shape — non-standard, so read
 * defensively (same pattern as `features/rum/connection-info.ts`'s own
 * comment: Safari and Firefox implement none of it).
 */
export interface ConnectionLike {
  saveData?: boolean;
  type?: string;
  effectiveType?: string;
}

export interface NavigatorWithConnection extends Navigator {
  connection?: ConnectionLike;
}

/**
 * True when the API positively reports a cellular link or data-saver mode.
 * No API at all, wifi and ethernet all read as false — VideoSurface then
 * defaults to 540p (TASKS.md 3.5.b), never the cellular-conservative 360p,
 * for a connection it cannot positively identify as cellular.
 */
export function isCellularConnection(connection: ConnectionLike | null | undefined): boolean {
  if (!connection) {
    return false;
  }
  return connection.type === "cellular" || connection.saveData === true;
}

/** Feature-detects `navigator.connection`; undefined in jsdom and unsupported browsers alike. */
export function readNavigatorConnection(): ConnectionLike | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  return (navigator as NavigatorWithConnection).connection;
}
