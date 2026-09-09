import { sleep } from '../lib/concurrency';
import { getToken } from '../da';

const DA_API = 'https://admin.da.live';
const HLX_ADMIN = 'https://admin.hlx.page';
const BRANCH = 'main';

function parseDAPath(daPath: string): { org: string; repo: string; contentPath: string } {
  const parts = daPath.replace(/\.html$/, '').split('/').filter(Boolean);
  const [org, repo, ...rest] = parts;
  return { org, repo, contentPath: `/${rest.join('/')}` };
}

export function daPathToPreviewUrl(daPath: string): string {
  const { org, repo, contentPath } = parseDAPath(daPath);
  return `https://${BRANCH}--${repo}--${org}.aem.page${contentPath}`;
}

export function daPathToLiveUrl(daPath: string): string {
  const { org, repo, contentPath } = parseDAPath(daPath);
  return `https://${BRANCH}--${repo}--${org}.aem.live${contentPath}`;
}

export interface DaListItem {
  path: string;
  ext?: string;
  /** Last-modified timestamp from `/list` (epoch seconds/ms or ISO — normalized when rendered). */
  lastModified?: string | number;
}

export async function listDirectory(dirPath: string): Promise<DaListItem[]> {
  const t = getToken();
  if (!t) throw new Error('DA token not set; set VITE_DA_TOKEN or run from DA.live');
  // The DA /list API is S3/R2-backed and lists ~1000 entries per folder at a time, returning a
  // `da-continuation-token` response header when the folder listing is truncated. Follow it until
  // the whole folder is read — otherwise a folder with >1000 direct children is silently cut to
  // its first page, pinning the scan at a fixed count no matter how many documents are added.
  const items: DaListItem[] = [];
  let continuationToken: string | null = null;
  for (let guard = 0; guard < 1_000_000; guard++) {
    const headers: Record<string, string> = { Authorization: `Bearer ${t}` };
    if (continuationToken) headers['da-continuation-token'] = continuationToken;
    const resp = await fetch(`${DA_API}/list${dirPath}`, { headers });
    if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
    const pageItems = await resp.json() as DaListItem[];
    items.push(...pageItems);
    continuationToken = resp.headers.get('da-continuation-token');
    if (!continuationToken) break;
  }
  return items;
}

export interface DirectoryCheckResult {
  valid: boolean;
  error?: string;
}

export async function checkDirectoryExists(dirPath: string): Promise<DirectoryCheckResult> {
  try {
    await listDirectory(dirPath);
    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const is403 = msg.startsWith('403');
    const is404 = msg.startsWith('404');
    return {
      valid: false,
      error: is403
        ? "Access denied — you don't have permission to read this directory"
        : is404
        ? 'Directory not found — confirm the path exists in DA'
        : `Could not verify directory (${msg})`,
    };
  }
}

export async function triggerPreview(daPath: string, token: string): Promise<void> {
  const { org, repo, contentPath } = parseDAPath(daPath);
  const resp = await fetch(`${HLX_ADMIN}/preview/${org}/${repo}/${BRANCH}${contentPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`preview ${daPath}: ${resp.status}`);
}

export async function triggerPublish(daPath: string, token: string): Promise<void> {
  const { org, repo, contentPath } = parseDAPath(daPath);
  const resp = await fetch(`${HLX_ADMIN}/live/${org}/${repo}/${BRANCH}${contentPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`publish ${daPath}: ${resp.status}`);
}

export async function triggerUnpublish(daPath: string, token: string): Promise<void> {
  const { org, repo, contentPath } = parseDAPath(daPath);
  const resp = await fetch(`${HLX_ADMIN}/live/${org}/${repo}/${BRANCH}${contentPath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`unpublish ${daPath}: ${resp.status}`);
}

export async function deleteDocument(daPath: string, token: string): Promise<void> {
  const fullpath = `${DA_API}/source${daPath}${daPath.endsWith('.html') ? '' : '.html'}`;
  const resp = await fetch(fullpath, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`delete ${daPath}: ${resp.status}`);
}

export interface PageStatus {
  live: boolean;
  preview: boolean;
  /** False when the status check failed (rate-limited/unreachable); live/preview are then not meaningful. */
  ok: boolean;
  /** Most-recent lifecycle timestamp (source/preview/publish) from the bulk status job, if available. */
  lastModified?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scalable status resolution: bulk status job (primary) → authless CDN HEAD (fallback).
//
// Never GETs admin.hlx.page/status per document — that endpoint is rate-limited to ~10 req/s per
// project and so mass-fails a large scan (the ~6k-doc "N docs Unknown" storm). The bulk job
// statuses the whole set in one async job; if it's unavailable or returns an unrecognized shape,
// we fall back to bodyless/authless HEAD probes of the live CDN (200 req/s host limit), which
// reliably determine "published".
// ─────────────────────────────────────────────────────────────────────────────

const BULK_STATUS_CHUNK = 1000; // paths per bulk status job (primary pass — fast, few jobs)
const RECONCILE_CHUNK = 100; // smaller batch for re-running dropped paths (the job drops fewer when small)
const RECONCILE_ATTEMPTS = 2; // re-run the missing diff this many times before the HEAD net
const JOB_POLL_MS = 1000; // delay between job-status polls
const JOB_POLL_MAX = 180; // give up on a job after ~3 min → fall back
const HEAD_BATCH_SIZE = 20; // paths probed in parallel per HEAD batch
const HEAD_BATCH_MS = 300; // min ms per HEAD batch (paces well under the CDN's 200 req/s)

type StatusProgress = (done: number, total: number) => void;

/**
 * Resolve publish/preview status for many docs without hammering the rate-limited admin status
 * API. Tries the AEM bulk status job first; on any failure/unsupported/unrecognized response it
 * falls back to authless CDN HEAD probes (reliable for "published").
 */
export async function resolveStatuses(
  paths: string[],
  token: string,
  onProgress?: StatusProgress,
): Promise<Map<string, PageStatus>> {
  if (paths.length === 0) return new Map();
  try {
    return await bulkResolveStatus(paths, token, onProgress);
  } catch {
    return await headResolveStatus(paths, onProgress);
  }
}

/**
 * Authless, bodyless HEAD probe of the live CDN: live = 200. The preview tier is often
 * auth-gated, so it isn't probed here — a not-live doc reads as Draft in this fallback.
 */
export async function headResolveStatus(
  paths: string[],
  onProgress?: StatusProgress,
): Promise<Map<string, PageStatus>> {
  const result = new Map<string, PageStatus>();
  for (let i = 0; i < paths.length; i += HEAD_BATCH_SIZE) {
    const batchStart = Date.now();
    const batch = paths.slice(i, i + HEAD_BATCH_SIZE);
    await Promise.all(batch.map(async (p) => {
      let live = false;
      try {
        const resp = await fetch(daPathToLiveUrl(p), { method: 'HEAD' });
        live = resp.ok;
      } catch { /* CDN unreachable → treat as not published */ }
      result.set(p, { live, preview: false, ok: true });
    }));
    if (onProgress) onProgress(Math.min(i + batch.length, paths.length), paths.length);
    const wait = HEAD_BATCH_MS - (Date.now() - batchStart);
    if (wait > 0 && i + HEAD_BATCH_SIZE < paths.length) await sleep(wait);
  }
  return result;
}

/**
 * Bulk status via the AEM admin job API. The job silently drops paths whose source-side lookup
 * transiently fails (more so in big batches, and disproportionately for drafts), so after the fast
 * primary pass we diff requested-vs-returned and re-run the missing set in small batches (which the
 * job resolves reliably), then fall back to the authless HEAD probe for any residual — resolving
 * the stragglers up front instead of surfacing them as Unknown, while keeping the scan fast.
 */
export async function bulkResolveStatus(
  paths: string[],
  token: string,
  onProgress?: StatusProgress,
): Promise<Map<string, PageStatus>> {
  const { org, repo } = parseDAPath(paths[0]);
  const result = new Map<string, PageStatus>();
  const report = () => onProgress?.(Math.min(result.size, paths.length), paths.length);

  // Run a set of DA paths through the job in `chunkSize` chunks, merging results keyed by DA path.
  async function runPass(daPaths: string[], chunkSize: number): Promise<void> {
    for (let i = 0; i < daPaths.length; i += chunkSize) {
      const chunk = daPaths.slice(i, i + chunkSize);
      const contentToDa = new Map<string, string>();
      const contentPaths = chunk.map((p) => {
        const cp = parseDAPath(p).contentPath;
        contentToDa.set(cp, p);
        return cp;
      });
      const statuses = await runBulkStatusChunk(org, repo, contentPaths, token);
      for (const [cp, st] of statuses) {
        const da = contentToDa.get(cp);
        if (da) result.set(da, st);
      }
      report();
    }
  }

  // Primary pass — big chunks. May throw → resolveStatuses() falls back to full HEAD.
  await runPass(paths, BULK_STATUS_CHUNK);

  // Reconcile the paths the job dropped by re-running just those in small batches. Best-effort: a
  // hiccup here must never discard the good primary results.
  for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt++) {
    const missing = paths.filter((p) => !result.has(p));
    if (missing.length === 0) break;
    try {
      await runPass(missing, RECONCILE_CHUNK);
    } catch {
      break;
    }
  }

  // Final net: resolve any still-missing path via the authless CDN HEAD probe (reliable for
  // "published"), so a dropped-but-published doc is caught rather than mislabeled.
  const stillMissing = paths.filter((p) => !result.has(p));
  if (stillMissing.length > 0) {
    try {
      const headStatuses = await headResolveStatus(stillMissing);
      for (const [p, st] of headStatuses) result.set(p, st);
      report();
    } catch { /* fall through to Unknown */ }
  }

  // Anything the HEAD net couldn't reach either → genuinely Unknown (recheckable).
  for (const p of paths) if (!result.has(p)) result.set(p, { live: false, preview: false, ok: false });
  return result;
}

type BulkResource = {
  path?: string; webPath?: string; resourcePath?: string;
  // A bulk STATUS job reports lifecycle state as timestamps, present iff the doc exists in that
  // tier — NOT as `{ status: 200 }` objects (those belong to the single-path status endpoint).
  sourceLastModified?: string; previewLastModified?: string; publishLastModified?: string;
};

async function runBulkStatusChunk(
  org: string,
  repo: string,
  contentPaths: string[],
  token: string,
): Promise<Map<string, PageStatus>> {
  // 1. Start the async bulk status job for these paths.
  const startResp = await fetch(`${HLX_ADMIN}/status/${org}/${repo}/${BRANCH}/*`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: contentPaths, select: ['edit', 'preview', 'live'], forceAsync: true }),
  });
  if (!startResp.ok) throw new Error(`bulk status start: ${startResp.status}`);
  const startData = await startResp.json() as { job?: { name?: string }; links?: { self?: string } };
  const jobName = startData.job?.name ?? startData.links?.self?.split('/').pop();
  if (!jobName) throw new Error('bulk status: missing job name');

  // 2. Poll until the job stops.
  const jobUrl = `${HLX_ADMIN}/job/${org}/${repo}/${BRANCH}/status/${jobName}`;
  let stopped = false;
  for (let attempt = 0; attempt < JOB_POLL_MAX && !stopped; attempt++) {
    await sleep(JOB_POLL_MS);
    const jResp = await fetch(jobUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!jResp.ok) throw new Error(`bulk status poll: ${jResp.status}`);
    const jData = await jResp.json() as { state?: string };
    stopped = jData.state === 'stopped' || jData.state === 'completed';
  }
  if (!stopped) throw new Error('bulk status: job did not finish in time');

  // 3. Read per-path results. A bulk STATUS job's /details reports lifecycle state as timestamps
  // under data.resources[] — `publishLastModified` (⇒ live/published) and `previewLastModified`
  // (⇒ previewed), NOT `{ status: 200 }`. Two guards force a fallback to the reliable HEAD probe
  // rather than silently reporting Draft: a path-key mismatch (keys don't match what we requested)
  // and a field mismatch (no resource carries any known lifecycle timestamp — i.e. shape changed).
  const dResp = await fetch(`${jobUrl}/details`, { headers: { Authorization: `Bearer ${token}` } });
  if (!dResp.ok) throw new Error(`bulk status details: ${dResp.status}`);
  const details = await dResp.json() as { data?: { resources?: unknown }; resources?: unknown };
  const resources = details.data?.resources ?? details.resources;
  if (!Array.isArray(resources)) throw new Error('bulk status: unrecognized details shape');
  const out = new Map<string, PageStatus>();
  let recognizedShape = false;
  for (const item of resources as BulkResource[]) {
    const path = item.path ?? item.webPath ?? item.resourcePath;
    if (!path) continue;
    if (item.sourceLastModified || item.previewLastModified || item.publishLastModified) {
      recognizedShape = true;
    }
    // Most-recent of the three lifecycle timestamps (ISO strings sort chronologically).
    const times = [item.sourceLastModified, item.previewLastModified, item.publishLastModified]
      .filter((t): t is string => Boolean(t))
      .sort();
    out.set(path, {
      live: Boolean(item.publishLastModified),
      preview: Boolean(item.previewLastModified),
      ok: true,
      lastModified: times.at(-1),
    });
  }
  if (resources.length > 0 && !recognizedShape) {
    console.warn('bulk status: unrecognized resource shape, falling back to HEAD probe', resources[0]);
    throw new Error('bulk status: unrecognized resource shape');
  }
  const matched = contentPaths.filter((cp) => out.has(cp)).length;
  if (matched < contentPaths.length * 0.5) {
    throw new Error(`bulk status: path-format mismatch (${matched}/${contentPaths.length})`);
  }
  return out;
}
