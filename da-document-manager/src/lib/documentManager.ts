import { crawlDirectory, type CrawlError } from '../api/crawl';
import { getToken } from '../da';
import { daPathToLiveUrl, daPathToPreviewUrl, resolveStatuses, type DaListItem, type PageStatus } from '../api/daApi';
import { CRAWL_CONCURRENCY } from './concurrency';
import type { DocRow } from '../types';

export type ScanPhase = 'discovering' | 'checking';

export interface StatusUpdate {
  path: string;
  stage?: DocRow['stage'];
  statusUnknown?: boolean;
  liveUrl?: string;
  previewUrl?: string;
  lastUpdated?: string;
}

export interface ScanCallbacks {
  /** Placeholder rows (path + last-modified) available immediately after discovery. */
  onDiscovered: (docs: DocRow[], total: number) => void;
  /** A batch of publish/preview status results (or Unknown), to merge into the rows by path. */
  onStatuses: (updates: StatusUpdate[]) => void;
  onProgress: (phase: ScanPhase, done: number, total: number) => void;
  /** Return true to abort — checked between async steps so a rescan/unmount stops work. */
  cancelled: () => boolean;
}

const FLUSH_SIZE = 25;

function placeholderRow(item: DaListItem): DocRow {
  return { id: item.path, path: item.path, stage: 'draft', lastUpdated: item.lastModified };
}

/** Map a resolved PageStatus onto a row update (published / previewed / draft / unknown). */
function statusToUpdate(path: string, s: PageStatus | undefined): StatusUpdate {
  if (!s || !s.ok) return { path, statusUnknown: true };
  const base: StatusUpdate = { path, statusUnknown: false, lastUpdated: s.lastModified };
  if (s.live) return { ...base, stage: 'published', liveUrl: daPathToLiveUrl(path) };
  if (s.preview) return { ...base, stage: 'previewed', previewUrl: daPathToPreviewUrl(path) };
  return base; // exists in source only → Draft
}

/** Emit resolved statuses to the caller in FLUSH_SIZE batches (one merge per batch, not per row). */
function emitStatuses(
  paths: string[],
  statuses: Map<string, PageStatus>,
  onStatuses: (updates: StatusUpdate[]) => void,
): void {
  let buf: StatusUpdate[] = [];
  paths.forEach((path, idx) => {
    buf.push(statusToUpdate(path, statuses.get(path)));
    if (buf.length >= FLUSH_SIZE || idx === paths.length - 1) {
      onStatuses(buf);
      buf = [];
    }
  });
}

/**
 * Segmented, progressive scan: (1) discover paths and emit placeholder rows immediately, then
 * (2) live-check publish/preview status for the whole set via the bulk status job (one async job)
 * with an authless CDN-HEAD fallback — no per-doc calls to the rate-limited admin status API, so a
 * large scan can't trip its throttle and mass-mark rows Unknown. There is no per-doc source fetch:
 * this manager shows generic spine columns only, so it never needs each document's HTML/metadata.
 * Progress and partial results stream via callbacks; the caller aborts by flipping `cancelled()`.
 */
export async function scanDocs(
  rootPath: string,
  cb: ScanCallbacks,
): Promise<{ errors: CrawlError[] }> {
  // Phase 1 — discovery. Emit placeholder rows the moment paths are known.
  cb.onProgress('discovering', 0, 0);
  const crawl = await crawlDirectory(rootPath, { concurrency: CRAWL_CONCURRENCY });
  if (cb.cancelled()) return { errors: crawl.errors };
  const paths = crawl.docs.map((d) => d.path);
  const total = paths.length;
  cb.onDiscovered(crawl.docs.map(placeholderRow), total);

  // Phase 2 — status. Resolve publish/preview state for the whole set.
  const token = getToken();
  if (token && total > 0) {
    cb.onProgress('checking', 0, total);
    const statuses = await resolveStatuses(paths, token, (done) => {
      if (!cb.cancelled()) cb.onProgress('checking', done, total);
    });
    if (cb.cancelled()) return { errors: crawl.errors };
    emitStatuses(paths, statuses, cb.onStatuses);
    cb.onProgress('checking', total, total);
  }

  return { errors: crawl.errors };
}

/**
 * Re-resolve publish/preview status for a SUBSET of already-listed docs — used by the "Recheck
 * status" action to retry only the rows that came back Unknown (or "Refresh status" for all rows),
 * without re-crawling the tree. Reuses the same bulk-job → HEAD resolver.
 */
export async function recheckStatuses(
  paths: string[],
  cb: Pick<ScanCallbacks, 'onStatuses' | 'onProgress' | 'cancelled'>,
): Promise<void> {
  const token = getToken();
  if (!token || paths.length === 0) return;
  const total = paths.length;
  cb.onProgress('checking', 0, total);
  const statuses = await resolveStatuses(paths, token, (done) => {
    if (!cb.cancelled()) cb.onProgress('checking', done, total);
  });
  if (cb.cancelled()) return;
  emitStatuses(paths, statuses, cb.onStatuses);
  cb.onProgress('checking', total, total);
}
