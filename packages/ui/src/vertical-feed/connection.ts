/**
 * Narrow, ambient Network Information API shape — non-standard, so read
 * defensively (mirrors `apps/web/features/rum/connection-info.ts`'s own
 * comment on why: Safari and Firefox implement none of it, and even Chromium
 * never implements `type`).
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
 * True only when the API positively reports a cellular link or data-saver
 * mode. No API at all (most desktop Chrome, all of Safari/Firefox), wifi and
 * ethernet all read as false — TASKS.md 3.5.a: "preload...only when not on
 * cellular and saveData is false". Takes the connection object as a
 * parameter rather than reading `navigator.connection` itself, so this stays
 * testable with a plain object and no jsdom network-API shim.
 */
export function isCellularOrSaveData(connection: ConnectionLike | null | undefined): boolean {
  if (!connection) {
    return false;
  }
  return connection.saveData === true || connection.type === "cellular";
}

/** Feature-detects `navigator.connection`; undefined in jsdom and unsupported browsers alike. */
export function readNavigatorConnection(): ConnectionLike | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  return (navigator as NavigatorWithConnection).connection;
}
