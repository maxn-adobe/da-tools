import type { Dispatch, SetStateAction } from 'react';
import {
  getToken,
  triggerPreview,
  triggerPublish,
  triggerUnpublish,
  deleteDocument,
  daPathToPreviewUrl,
  daPathToLiveUrl,
  bulkPreview,
  bulkPublish,
  bulkUnpublish,
  type BulkMutateOutcome,
} from '../api/daApi';
import { runPageQa } from '../lib/generate';
import { runBatch } from '../lib/concurrency';
import type { RowResult, RowStage, QaResult } from '../types';

/** Which bulk operation is reporting progress (drives an n/m counter in the panel). */
export type BulkProgressOp = 'previewing' | 'publishing' | 'unpublishing';

/** Post-publish page-QA policy for the bulk publish path. */
export interface PublishQaConfig {
  mode: 'off' | 'sample' | 'all';
  sampleSize?: number;
}

export interface DaDocumentActionsOptions<T extends RowResult> {
  /**
   * Called after a successful delete. Return the row's replacement state (e.g. reset to
   * `{id, path, stage: 'pending'}` if the row should stay visible as not-yet-generated) or
   * `undefined` to remove the row from the list entirely (e.g. the document is just gone).
   */
  afterDelete: (row: T) => T | undefined;
  /** Progress for the job-based bulk preview/publish/unpublish, fed from the job's processed/total. */
  onBulkProgress?: (op: BulkProgressOp, done: number, total: number) => void;
  /** Publish-time page-QA policy. Defaults to 'off' — no live-page fetches at scale. */
  publishQaConfig?: PublishQaConfig;
}

export interface DaDocumentActions<T extends RowResult> {
  previewRow: (row: T) => Promise<void>;
  publishRow: (row: T) => Promise<void>;
  unpublishRow: (row: T) => Promise<void>;
  deleteRow: (row: T) => Promise<void>;
  previewBulk: (rows: T[]) => Promise<void>;
  publishBulk: (rows: T[]) => Promise<void>;
  unpublishBulk: (rows: T[]) => Promise<void>;
  deleteBulk: (rows: T[]) => Promise<void>;
}

const DEFAULT_QA_SAMPLE = 10;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useDaDocumentActions<T extends RowResult>(
  setResults: Dispatch<SetStateAction<T[]>>,
  options: DaDocumentActionsOptions<T>,
): DaDocumentActions<T> {
  function patch(id: string, changes: Partial<T>) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  }

  function patchMany(ids: Set<string>, changes: Partial<T>) {
    setResults((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, ...changes } : r)));
  }

  // ── Single-row actions (table pills) — per-path endpoints, unchanged ────────────────────────
  async function previewOne(row: T) {
    const token = getToken();
    if (!token) return;
    patch(row.id, { stage: 'previewing' } as Partial<T>);
    try {
      await triggerPreview(row.path, token);
      patch(row.id, { stage: 'previewed', previewUrl: daPathToPreviewUrl(row.path) } as Partial<T>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patch(row.id, { stage: 'error', error: msg } as Partial<T>);
    }
  }

  async function publishOne(row: T) {
    const token = getToken();
    if (!token) return;
    patch(row.id, { stage: 'publishing' } as Partial<T>);
    try {
      await triggerPublish(row.path, token);
      const liveUrl = daPathToLiveUrl(row.path);
      let qa: QaResult | undefined;
      try {
        const resp = await fetch(liveUrl);
        const html = await resp.text();
        qa = runPageQa(html);
      } catch {
        // QA fetch failed — page is still published, just no QA data
      }
      patch(row.id, { stage: 'published', liveUrl, qa } as Partial<T>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patch(row.id, { stage: 'error', error: msg } as Partial<T>);
    }
  }

  async function unpublishOne(row: T) {
    const token = getToken();
    if (!token) return;
    patch(row.id, { stage: 'unpublishing' } as Partial<T>);
    try {
      await triggerUnpublish(row.path, token);
      patch(row.id, { stage: 'unpublished', liveUrl: undefined } as Partial<T>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patch(row.id, { stage: 'error', error: msg } as Partial<T>);
    }
  }

  async function deleteOne(row: T) {
    const token = getToken();
    if (!token) return;
    patch(row.id, { stage: 'deleting' } as Partial<T>);
    try {
      await deleteDocument(row.path, token);
      const replacement = options.afterDelete(row);
      setResults((prev) =>
        replacement
          ? prev.map((r) => (r.id === row.id ? replacement : r))
          : prev.filter((r) => r.id !== row.id),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patch(row.id, { stage: 'error', error: msg } as Partial<T>);
    }
  }

  // ── Bulk actions — one AEM job per ~500 paths, reconciled per-path ──────────────────────────
  async function runBulkStage(
    rows: T[],
    inFlight: RowStage,
    op: BulkProgressOp,
    bulkFn: (paths: string[], token: string, onProgress?: (done: number, total: number) => void) => Promise<BulkMutateOutcome>,
    onSuccess: (row: T) => Partial<T>,
    perRowFallback: (row: T) => Promise<void>,
  ): Promise<BulkMutateOutcome | undefined> {
    const token = getToken();
    if (!token || rows.length === 0) return undefined;
    const ids = new Set(rows.map((r) => r.id));
    patchMany(ids, { stage: inFlight, error: undefined } as Partial<T>);
    const paths = [...new Set(rows.map((r) => r.path))];
    try {
      const outcome = await bulkFn(paths, token, (done, total) => options.onBulkProgress?.(op, done, total));
      setResults((prev) => prev.map((r) => {
        if (!ids.has(r.id)) return r;
        if (outcome.succeeded.has(r.path)) return { ...r, ...onSuccess(r) };
        const reason = outcome.failed.get(r.path);
        return reason ? ({ ...r, stage: 'error', error: reason } as T) : r;
      }));
      return outcome;
    } catch {
      // Whole-op failure (token lost, unexpected throw) → per-row fan-out (full per-row UI).
      await runBatch(rows, perRowFallback);
      return undefined;
    }
  }

  async function runSampledPublishQa(succeededPaths: string[], cfg?: PublishQaConfig) {
    if (!cfg || cfg.mode === 'off' || succeededPaths.length === 0) return;
    const sample = cfg.mode === 'all'
      ? succeededPaths
      : shuffle(succeededPaths).slice(0, cfg.sampleSize ?? DEFAULT_QA_SAMPLE);
    await runBatch(sample, async (path) => {
      try {
        const resp = await fetch(daPathToLiveUrl(path));
        const html = await resp.text();
        const qa = runPageQa(html);
        setResults((prev) => prev.map((r) => (r.path === path ? ({ ...r, qa } as T) : r)));
      } catch {
        // page is still published; just no QA data
      }
    });
  }

  async function previewBulk(rows: T[]) {
    await runBulkStage(
      rows, 'previewing', 'previewing', bulkPreview,
      (r) => ({ stage: 'previewed', previewUrl: daPathToPreviewUrl(r.path) } as Partial<T>),
      previewOne,
    );
  }

  async function publishBulk(rows: T[]) {
    const outcome = await runBulkStage(
      rows, 'publishing', 'publishing', bulkPublish,
      (r) => ({ stage: 'published', liveUrl: daPathToLiveUrl(r.path) } as Partial<T>),
      publishOne,
    );
    if (outcome) await runSampledPublishQa([...outcome.succeeded], options.publishQaConfig);
  }

  async function unpublishBulk(rows: T[]) {
    await runBulkStage(
      rows, 'unpublishing', 'unpublishing', bulkUnpublish,
      () => ({ stage: 'unpublished', liveUrl: undefined } as Partial<T>),
      unpublishOne,
    );
  }

  return {
    previewRow: previewOne,
    publishRow: publishOne,
    unpublishRow: unpublishOne,
    deleteRow: deleteOne,
    previewBulk,
    publishBulk,
    unpublishBulk,
    deleteBulk: (rows) => runBatch(rows, deleteOne),
  };
}
