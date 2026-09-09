import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { scanDocs, recheckStatuses, loadBatchMetadata, type ScanPhase } from '../lib/documentManager';
import { checkDirectoryExists, daPathToLiveUrl, daPathToPreviewUrl, daPathToProdUrl } from '../api/daApi';
import type { CrawlError } from '../api/crawl';
import { useDaDocumentActions } from '../hooks/useDaDocumentActions';
import ConfirmModal from './ConfirmModal';
import DrillDownNav from './DrillDownNav';
import DocumentManagerTable, { type SortField } from './DocumentManagerTable';
import type { DocRow } from '../types';

const ALL = 'all';
const NO_BATCH = '(no batch)';
type StatusKey = 'draft' | 'previewed' | 'published' | 'unknown';
type BulkConfirmOp = 'preview' | 'publish' | 'unpublish' | 'delete';
type UrlExportKind = 'document' | 'preview' | 'live' | 'prod';

/** Collapse a row's stage + statusUnknown flag to the four author-facing status buckets. */
function statusOf(d: DocRow): StatusKey {
  if (d.statusUnknown) return 'unknown';
  if (d.stage === 'published') return 'published';
  if (d.stage === 'previewed') return 'previewed';
  return 'draft';
}

/** A row's subDirectory (`/hoodie/red`, or `/` at root) as folder segments (root = []). */
function toSegs(subDirectory: string): string[] {
  return subDirectory === '/' ? [] : subDirectory.slice(1).split('/');
}

function ScanProgressBar({ progress }: { progress: { phase: ScanPhase; done: number; total: number } }) {
  const { phase, done, total } = progress;
  const label = phase === 'discovering'
    ? 'Discovering documents…'
    : `Checking status… ${done} / ${total}`;
  const pct = total > 0 ? Math.round((done / total) * 100) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{label}</span>
        {pct !== null && <span className="tabular-nums">{pct}%</span>}
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full bg-blue-500 ${pct === null ? 'w-1/3 animate-pulse' : 'transition-[width] duration-200'}`}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

export default function DocumentManagerView() {
  const [rootPathInput, setRootPathInput] = useState('');
  // Starts null so the scan is manual — kicked off by the Scan button via handleScan.
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [scanNonce, setScanNonce] = useState(0);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [crawlErrors, setCrawlErrors] = useState<CrawlError[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [drillPath, setDrillPath] = useState<string[]>([]);
  const [batchFilter, setBatchFilter] = useState<string>(ALL);
  const [batchDataState, setBatchDataState] = useState<'none' | 'loading' | 'loaded'>('none');
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const batchLoadId = useRef(0); // monotonic cancel token for the in-flight batch load
  const [sortField, setSortField] = useState<SortField>('path');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [confirmOp, setConfirmOp] = useState<BulkConfirmOp | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissedErrors, setDismissedErrors] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [scanProgress, setScanProgress] = useState<{ phase: ScanPhase; done: number; total: number } | null>(null);
  const scanning = scanProgress !== null;

  const actions = useDaDocumentActions<DocRow>(setDocs, { afterDelete: () => undefined });

  async function handleScan() {
    const trimmed = rootPathInput.trim();
    if (!trimmed) return;
    // A DA path is /org/repo[/subpath…]; org + repo are required (parseDAPath derives them).
    const segments = trimmed.split('/').filter(Boolean);
    if (!trimmed.startsWith('/') || segments.length < 2) {
      setPathError('Enter a full DA path: /org/repo/optional/subpath');
      return;
    }
    setPathError(null);
    setValidating(true);
    const check = await checkDirectoryExists(trimmed);
    setValidating(false);
    if (!check.valid) {
      setPathError(check.error ?? 'Could not read that directory');
      return;
    }
    setRootPath(trimmed);
    setScanNonce((n) => n + 1);
  }

  // Run the segmented scan whenever the path changes or Rescan bumps scanNonce. A `stale` flag
  // (flipped in cleanup) makes a superseded or unmounted scan's callbacks no-ops.
  useEffect(() => {
    if (rootPath === null) return;
    // A new scan invalidates any in-flight batch-metadata load and resets the drill nav + filters
    // (the tree changed, so a stale prefix/batch could point at folders/values that no longer exist).
    batchLoadId.current += 1;
    setBatchDataState('none');
    setBatchFilter(ALL);
    setBatchProgress(null);
    setDrillPath([]);
    let stale = false;
    void scanDocs(rootPath, {
      onDiscovered: (placeholders) => {
        if (stale) return;
        setDocs(placeholders);
        setSelected(new Set());
        setDismissedErrors(false);
      },
      onStatuses: (updates) => {
        if (stale) return;
        const byPath = new Map(updates.map((u) => [u.path, u]));
        setDocs((prev) => prev.map((d) => {
          const u = byPath.get(d.path);
          // Prefer the last-modified from discovery; only backfill from the status job if absent.
          return u ? { ...d, ...u, lastUpdated: d.lastUpdated ?? u.lastUpdated } : d;
        }));
      },
      onProgress: (phase, done, total) => {
        if (stale) return;
        setScanProgress({ phase, done, total });
      },
      cancelled: () => stale,
    }).then(
      ({ errors }) => {
        if (stale) return;
        setCrawlErrors(errors);
        setHasScanned(true);
        setScanProgress(null);
      },
      (err: unknown) => {
        if (stale) return;
        setCrawlErrors([{ dirPath: rootPath, message: err instanceof Error ? err.message : String(err) }]);
        setHasScanned(true);
        setScanProgress(null);
      },
    );
    // Abort the in-flight scan when a rescan starts or the component unmounts.
    return () => { stale = true; };
  }, [rootPath, scanNonce]);

  // Re-resolve status for a set of already-listed rows — no re-crawl. Shared by "Recheck status"
  // (unknowns only) and "Refresh status" (all rows).
  async function runStatusCheck(paths: string[]) {
    if (scanning || paths.length === 0) return;
    setScanProgress({ phase: 'checking', done: 0, total: paths.length });
    try {
      await recheckStatuses(paths, {
        onStatuses: (updates) => {
          const byPath = new Map(updates.map((u) => [u.path, u]));
          setDocs((prev) => prev.map((d) => {
            const u = byPath.get(d.path);
            return u ? { ...d, ...u, lastUpdated: d.lastUpdated ?? u.lastUpdated } : d;
          }));
        },
        onProgress: (phase, done, total) => setScanProgress({ phase, done, total }),
        cancelled: () => false,
      });
    } finally {
      setScanProgress(null);
    }
  }

  function handleRecheckUnknowns() {
    void runStatusCheck(docs.filter((d) => d.statusUnknown).map((d) => d.path));
  }

  function handleRefreshStatus() {
    void runStatusCheck(docs.map((d) => d.path));
  }

  // Opt-in per-doc metadata pass — populates `generatedBatch` and enables the Batch filter. A
  // monotonic id makes a superseded (rescanned) load's callbacks no-ops.
  async function handleLoadBatchData() {
    if (batchDataState === 'loading' || docs.length === 0) return;
    const myId = (batchLoadId.current += 1);
    setBatchDataState('loading');
    setBatchProgress({ done: 0, total: docs.length });
    await loadBatchMetadata(docs.map((d) => d.path), {
      onBatches: (updates) => {
        if (batchLoadId.current !== myId) return;
        const byPath = new Map(updates.map((u) => [u.path, u]));
        setDocs((prev) => prev.map((d) => {
          const u = byPath.get(d.path);
          return u ? { ...d, generatedBatch: u.generatedBatch } : d;
        }));
      },
      onProgress: (done, total) => {
        if (batchLoadId.current === myId) setBatchProgress({ done, total });
      },
      cancelled: () => batchLoadId.current !== myId,
    });
    if (batchLoadId.current !== myId) return;
    setBatchDataState('loaded');
    setBatchProgress(null);
  }

  // Immediate child folders of the current drill level, with counts — derived from ALL docs (not
  // `filtered`) so status/batch filters never distort the folder tree.
  const drillChildren = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of docs) {
      const segs = toSegs(d.subDirectory);
      if (segs.length <= drillPath.length) continue; // sits in current level or above
      if (drillPath.some((s, i) => segs[i] !== s)) continue; // not under current prefix
      const child = segs[drillPath.length];
      counts.set(child, (counts.get(child) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [docs, drillPath]);

  // Distinct batch values (newest ISO first), with a "(no batch)" bucket last.
  const batches = useMemo(
    () => [...new Set(docs.map((d) => d.generatedBatch || NO_BATCH))]
      .sort((a, b) => (a === NO_BATCH ? 1 : b === NO_BATCH ? -1 : b.localeCompare(a))),
    [docs],
  );

  const filtered = useMemo(() => {
    const prefix = drillPath.length ? `/${drillPath.join('/')}` : null;
    return docs.filter((d) => {
      // Drill filter is prefix-inclusive: the folder itself and everything nested under it.
      if (prefix && !(d.subDirectory === prefix || d.subDirectory.startsWith(`${prefix}/`))) return false;
      if (statusFilter !== ALL && statusOf(d) !== statusFilter) return false;
      if (batchFilter !== ALL && (d.generatedBatch || NO_BATCH) !== batchFilter) return false;
      return true;
    });
  }, [docs, drillPath, statusFilter, batchFilter]);

  const sorted = useMemo(() => {
    const value = (d: DocRow): string => {
      switch (sortField) {
        case 'path': return d.path;
        case 'lastUpdated': return String(d.lastUpdated ?? '');
        case 'status': return statusOf(d);
        default: return '';
      }
    };
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = value(a).localeCompare(value(b));
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortField, sortDirection]);

  // Close the Export menu on any outside click.
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  // URLs are derived from each visible (sorted) doc's path + resolved stage.
  function collectUrls(kind: UrlExportKind): string[] {
    switch (kind) {
      case 'document':
        return sorted.map((d) => `https://da.live/edit#${d.path}`);
      case 'preview':
        return sorted
          .filter((d) => d.previewUrl || d.stage === 'previewed' || d.stage === 'published')
          .map((d) => daPathToPreviewUrl(d.path));
      case 'live':
        return sorted
          .filter((d) => d.liveUrl || d.stage === 'published')
          .map((d) => daPathToLiveUrl(d.path));
      case 'prod':
        return sorted
          .filter((d) => d.liveUrl || d.stage === 'published')
          .map((d) => daPathToProdUrl(d.path));
    }
  }

  function handleExportUrls(kind: UrlExportKind) {
    setShowExportMenu(false);
    const urls = collectUrls(kind);
    if (urls.length === 0) return; // options with 0 are disabled; this is a guard
    const label = { document: 'document', preview: 'preview', live: 'published-aem', prod: 'published-adobe' }[kind];
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([`${urls.join('\n')}\n`], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label}-urls-${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function toggleSelectAll() {
    const allSelected = sorted.length > 0 && sorted.every((d) => selected.has(d.path));
    setSelected(allSelected ? new Set() : new Set(sorted.map((d) => d.path)));
  }

  const selectedDocs = docs.filter((d) => selected.has(d.path));

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setSelected(new Set());
    }
  }

  const unknownCount = hasScanned && !scanning ? docs.filter((d) => d.statusUnknown).length : 0;
  const anyFilterActive = statusFilter !== ALL || batchFilter !== ALL || drillPath.length > 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="font-medium text-gray-900">Document Manager</h2>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={rootPathInput}
          onChange={(e) => setRootPathInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleScan(); }}
          placeholder="/org/repo/path"
          className="flex-1 min-w-[280px] max-w-md h-9 px-3 border border-gray-300 rounded-lg text-sm font-mono"
        />
        <button
          type="button"
          onClick={() => void handleScan()}
          disabled={scanning || validating || !rootPathInput.trim()}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          {validating ? 'Checking…' : scanning ? 'Scanning…' : rootPath === rootPathInput.trim() && hasScanned ? 'Rescan' : 'Scan'}
        </button>
        {hasScanned && !scanning && docs.length > 0 && (
          <button
            type="button"
            onClick={handleRefreshStatus}
            className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-xl border border-gray-300 hover:bg-gray-50 cursor-pointer transition-colors"
          >
            Refresh status
          </button>
        )}
        {hasScanned && !scanning && (
          <span className="text-sm text-gray-500">{docs.length} document{docs.length !== 1 ? 's' : ''} found</span>
        )}
      </div>

      {pathError && <p className="text-sm text-red-600">{pathError}</p>}

      {!hasScanned && !scanning && !pathError && (
        <p className="text-sm text-gray-500">Enter a DA folder path above and click Scan to load its documents.</p>
      )}

      {scanning && scanProgress && <ScanProgressBar progress={scanProgress} />}

      {crawlErrors.length > 0 && !dismissedErrors && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <p className="flex-1">
            {crawlErrors.length} path{crawlErrors.length !== 1 ? 's' : ''} could not be read and may be missing from this list.
          </p>
          <button type="button" onClick={() => setDismissedErrors(true)} className="text-amber-700 hover:text-amber-900 font-medium cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {unknownCount > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <p className="flex-1">
            Publish status couldn&apos;t be determined for {unknownCount} document{unknownCount !== 1 ? 's' : ''}; those rows show <strong>Unknown</strong> until rechecked.
          </p>
          <button
            type="button"
            onClick={handleRecheckUnknowns}
            className="font-medium text-amber-800 underline hover:text-amber-900 cursor-pointer whitespace-nowrap"
          >
            Recheck status
          </button>
        </div>
      )}

      {(docs.length > 0 || hasScanned) && (
        <>
          {(drillPath.length > 0 || drillChildren.length > 0) && (
            <DrillDownNav
              segments={drillPath}
              childFolders={drillChildren}
              onNavigate={(depth) => setDrillPath(drillPath.slice(0, depth))}
              onDrill={(name) => setDrillPath([...drillPath, name])}
            />
          )}

          <div className="flex items-center gap-3 flex-wrap text-sm">
            <label className="flex items-center gap-1.5 text-gray-600">
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-8 px-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value={ALL}>All</option>
                <option value="draft">Draft</option>
                <option value="previewed">Previewed</option>
                <option value="published">Published</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>

            {batchDataState === 'none' && docs.length > 0 && (
              <button
                type="button"
                onClick={() => void handleLoadBatchData()}
                className="px-3 py-1.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                Load batch data
              </button>
            )}
            {batchDataState === 'loading' && batchProgress && (
              <span className="text-gray-500 tabular-nums">
                Loading batch data… {batchProgress.done} / {batchProgress.total}
              </span>
            )}
            {batchDataState === 'loaded' && (
              <label className="flex items-center gap-1.5 text-gray-600">
                Batch
                <select
                  value={batchFilter}
                  onChange={(e) => setBatchFilter(e.target.value)}
                  className="h-8 px-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value={ALL}>All</option>
                  {batches.map((b) => (
                    <option key={b} value={b}>{b === NO_BATCH ? b : new Date(b).toLocaleDateString()}</option>
                  ))}
                </select>
              </label>
            )}

            {anyFilterActive && (
              <span className="text-gray-500">{filtered.length} shown</span>
            )}

            <div ref={exportMenuRef} className="relative ml-auto">
              <button
                type="button"
                onClick={() => setShowExportMenu((p) => !p)}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 cursor-pointer transition-colors flex items-center gap-1.5"
              >
                Export URLs
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-400">
                  <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </button>
              {showExportMenu && (() => {
                const opts: { kind: UrlExportKind; label: string }[] = [
                  { kind: 'document', label: 'Document links' },
                  { kind: 'preview', label: 'Preview links (.aem.page)' },
                  { kind: 'live', label: 'Published (.aem.live)' },
                  { kind: 'prod', label: 'Published (adobe.com)' },
                ];
                return (
                  <div className="absolute right-0 mt-1 w-60 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                    {opts.map(({ kind, label }, i) => {
                      const count = collectUrls(kind).length;
                      return (
                        <Fragment key={kind}>
                          {i > 0 && <div className="border-t border-gray-100" />}
                          <button
                            type="button"
                            disabled={count === 0}
                            onClick={() => handleExportUrls(kind)}
                            className="w-full text-left px-4 py-2.5 text-sm flex items-center justify-between text-gray-700 hover:bg-gray-50 cursor-pointer disabled:text-gray-300 disabled:hover:bg-white disabled:cursor-not-allowed"
                          >
                            <span>{label}</span>
                            <span className="text-gray-400">{count}</span>
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-sm bg-gray-50 border border-gray-200 rounded-xl px-4 py-2">
              <span className="font-medium text-gray-700">{selected.size} selected</span>
              <BulkButton label="Preview" onClick={() => setConfirmOp('preview')} busy={busy} className="text-indigo-700 hover:bg-indigo-50 border-indigo-200" />
              <BulkButton label="Publish" onClick={() => setConfirmOp('publish')} busy={busy} className="text-green-700 hover:bg-green-50 border-green-200" />
              <BulkButton label="Unpublish" onClick={() => setConfirmOp('unpublish')} busy={busy} className="text-red-700 hover:bg-red-50 border-red-200" />
              <BulkButton label="Delete" onClick={() => setConfirmOp('delete')} busy={busy} className="text-red-700 hover:bg-red-50 border-red-200" />
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="ml-auto text-gray-500 hover:text-gray-800 font-medium cursor-pointer"
              >
                Clear
              </button>
            </div>
          )}

          <DocumentManagerTable
            rows={sorted}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            allSelected={sorted.length > 0 && sorted.every((d) => selected.has(d.path))}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            actions={actions}
          />
        </>
      )}

      {confirmOp && (() => {
        const cfg = {
          preview: { verb: 'Preview', className: 'bg-indigo-600 hover:bg-indigo-700', run: () => actions.previewBulk(selectedDocs), body: 'This will (re)generate an aem.page preview for the following documents:' },
          publish: { verb: 'Publish', className: 'bg-green-600 hover:bg-green-700', run: () => actions.publishBulk(selectedDocs), body: 'This will publish the following documents to production:' },
          unpublish: { verb: 'Unpublish', className: 'bg-red-600 hover:bg-red-700', run: () => actions.unpublishBulk(selectedDocs), body: 'This will unpublish (remove from production) the following documents:' },
          delete: { verb: 'Delete', className: 'bg-red-700 hover:bg-red-800', run: () => actions.deleteBulk(selectedDocs), body: 'This will permanently delete the following documents from DA:' },
        }[confirmOp];
        return (
          <ConfirmModal
            title={`${cfg.verb} ${selectedDocs.length} document${selectedDocs.length !== 1 ? 's' : ''}?`}
            confirmLabel={cfg.verb}
            confirmClassName={`px-4 py-2 ${cfg.className} text-white text-sm font-medium rounded-xl cursor-pointer transition-colors`}
            onCancel={() => setConfirmOp(null)}
            onConfirm={() => { const run = cfg.run; setConfirmOp(null); void withBusy(run); }}
          >
            <p className="text-sm text-gray-500">{cfg.body}</p>
            <ul className="text-xs font-mono text-gray-700 max-h-64 overflow-y-auto border border-gray-100 rounded-lg p-3 flex flex-col gap-1">
              {selectedDocs.map((d) => <li key={d.path} className="whitespace-nowrap">{d.path}</li>)}
            </ul>
          </ConfirmModal>
        );
      })()}
    </div>
  );
}

function BulkButton({
  label,
  onClick,
  busy,
  className,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`px-3 py-1.5 bg-white text-xs font-medium rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors ${className}`}
    >
      {label}
    </button>
  );
}
