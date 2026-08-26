import { Fragment, useEffect, useRef, useState } from 'react';
import type { RowResult, RowStage } from '../types';
import type { DaDocumentActions } from '../hooks/useDaDocumentActions';
import { docExists } from '../api/daApi';
import { runBatch } from '../lib/concurrency';
import ConfirmModal from './ConfirmModal';
import {
  GeneratePill,
  PreviewPill,
  PublishPill,
  QaIssueBadge,
  ExternalLinkIcon,
  ExistenceBadge,
  ExistenceOutcomeBadge,
  type ExistenceCheck,
} from './StatusPills';

interface PreviewRow {
  id: string;
  path: string;
}

interface Props {
  canGenerate: boolean;
  generating: boolean;
  selectedCount: number;
  previewRows: PreviewRow[];
  onGenerate: () => void;
  onReset: () => void;
  results: RowResult[];
  actions: DaDocumentActions<RowResult>;
}

// Bulk operations other than generation (which App drives via the `generating` prop).
type BulkOp = 'idle' | 'previewing' | 'publishing' | 'unpublishing' | 'deleting';

type UrlExportKind = 'document' | 'preview' | 'live';

// Which action buttons were visible when a bulk op started — kept so they persist (disabled)
// through the op instead of vanishing as row stages change under them.
interface FrozenButtons {
  preview: boolean;
  publish: boolean;
  unpublish: boolean;
  delete: boolean;
}

// Stages at which the source document exists in DA — used to decide which rows contribute a
// document link to the URL export.
const DOC_EXISTS_STAGES: ReadonlySet<RowStage> = new Set<RowStage>([
  'generated', 'previewing', 'previewed', 'publishing', 'published', 'unpublishing', 'unpublished',
]);

// Stages whose document has been written to DA and can therefore be deleted.
const DELETABLE_STAGES: RowStage[] = [
  'generated', 'qa-fail', 'previewing', 'previewed', 'publishing',
  'published', 'unpublishing', 'unpublished',
];

export default function GeneratePanel({
  canGenerate,
  generating,
  selectedCount,
  previewRows,
  onGenerate,
  onReset,
  results,
  actions,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkOp, setBulkOp] = useState<BulkOp>('idle');
  const [bulkTotal, setBulkTotal] = useState(0);
  const bulkTargets = useRef<Set<string>>(new Set());
  const [frozen, setFrozen] = useState<FrozenButtons | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [existenceStatus, setExistenceStatus] = useState<Record<string, ExistenceCheck>>({});
  const checkedPaths = useRef<Set<string>>(new Set());
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Before generation we show a muted preview of the rows that will be generated (their resolved
  // output paths); once generation starts, `results` drives the same table with live pills.
  const preview = results.length === 0;
  const showTable = results.length > 0 || previewRows.length > 0;

  // While previewing (results empty), probe DA for each output path so the author sees which
  // rows will OVERWRITE an existing document before clicking Generate. Results are cached by path
  // (`checkedPaths`) so re-renders don't re-hit the API; the map persists through generation so the
  // per-row outcome badge can report "Created" vs "Updated" from the pre-generation snapshot.
  useEffect(() => {
    if (results.length > 0) return;
    const toCheck = previewRows.filter((pr) => pr.path && !checkedPaths.current.has(pr.path));
    if (toCheck.length === 0) return;
    toCheck.forEach((pr) => checkedPaths.current.add(pr.path));
    setExistenceStatus((prev) => {
      const next = { ...prev };
      for (const pr of toCheck) next[pr.path] = 'checking';
      return next;
    });
    void runBatch(toCheck, async (pr) => {
      try {
        const exists = await docExists(pr.path);
        setExistenceStatus((prev) => ({ ...prev, [pr.path]: exists ? 'exists' : 'not-found' }));
      } catch {
        setExistenceStatus((prev) => ({ ...prev, [pr.path]: 'error' }));
      }
    });
  }, [previewRows, results.length]);

  // Close the export dropdown on an outside click.
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

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const existingCount = previewRows.filter((pr) => existenceStatus[pr.path] === 'exists').length;
  const running = generating || bulkOp !== 'idle';

  // True while the pre-generation existence sweep is still resolving (some path unchecked or
  // in-flight). Generate stays disabled until the final duplicate count is known.
  const existenceChecking =
    results.length === 0 &&
    previewRows.some((pr) => {
      if (!pr.path) return false;
      const s = existenceStatus[pr.path];
      return s === undefined || s === 'checking';
    });

  // Bulk-button visibility + labels are derived from the result stages.
  const counts = {
    generated: results.filter((r) =>
      ['generated', 'previewing', 'previewed', 'publishing', 'published'].includes(r.stage),
    ).length,
    previewable: results.filter((r) => r.stage === 'generated').length,
    previewed: results.filter((r) => ['previewed', 'publishing', 'published'].includes(r.stage)).length,
    publishable: results.filter((r) => r.stage === 'previewed').length,
    published: results.filter((r) => r.stage === 'published').length,
    error: results.filter((r) => r.stage === 'error').length,
    deletable: results.filter((r) => DELETABLE_STAGES.includes(r.stage)).length,
  };

  // When a bulk op is running, keep the frozen set visible (disabled); otherwise derive from counts
  // (and hide during generation, when `running` is true but no bulk op is active).
  const showPreviewBtn = frozen ? frozen.preview : !running && counts.previewable > 0;
  const showPublishBtn = frozen ? frozen.publish : !running && counts.publishable > 0;
  const showUnpublishBtn = frozen ? frozen.unpublish : !running && counts.published >= 2;
  const showDeleteBtn = frozen ? frozen.delete : !running && counts.deletable >= 2;

  // How many of the current bulk op's targets have reached a terminal state — drives the "X / N"
  // progress label inside the active button. Deleted rows are removed from `results`, so delete
  // counts what's left.
  function bulkDone(): number {
    const ids = bulkTargets.current;
    switch (bulkOp) {
      case 'previewing':
        return results.filter((r) => ids.has(r.id) && (r.stage === 'previewed' || r.stage === 'error')).length;
      case 'publishing':
        return results.filter((r) => ids.has(r.id) && (r.stage === 'published' || r.stage === 'error')).length;
      case 'unpublishing':
        return results.filter((r) => ids.has(r.id) && (r.stage === 'unpublished' || r.stage === 'error')).length;
      case 'deleting':
        return bulkTotal - results.filter((r) => ids.has(r.id)).length;
      default:
        return 0;
    }
  }

  async function runBulk(
    op: Exclude<BulkOp, 'idle'>,
    targets: RowResult[],
    fn: (rows: RowResult[]) => Promise<void>,
  ) {
    setFrozen({
      preview: counts.previewable > 0 || op === 'previewing',
      publish: counts.publishable > 0 || op === 'publishing',
      unpublish: counts.published >= 2 || op === 'unpublishing',
      delete: counts.deletable >= 2 || op === 'deleting',
    });
    bulkTargets.current = new Set(targets.map((t) => t.id));
    setBulkTotal(targets.length);
    setBulkOp(op);
    await fn(targets);
    setBulkOp('idle');
    setFrozen(null);
  }

  const handlePreview = () =>
    runBulk('previewing', results.filter((r) => r.stage === 'generated'), actions.previewBulk);
  const handlePublish = () =>
    runBulk('publishing', results.filter((r) => r.stage === 'previewed'), actions.publishBulk);
  const handleUnpublish = () =>
    runBulk('unpublishing', results.filter((r) => r.stage === 'published'), actions.unpublishBulk);
  const handleBulkDelete = () => {
    setDeleteModalOpen(false);
    return runBulk('deleting', results.filter((r) => DELETABLE_STAGES.includes(r.stage)), actions.deleteBulk);
  };

  function handleReset() {
    setResetModalOpen(false);
    onReset();
    setExistenceStatus({});
    checkedPaths.current.clear();
    setBulkOp('idle');
    setFrozen(null);
  }

  function collectUrls(kind: UrlExportKind): string[] {
    switch (kind) {
      case 'document':
        return results
          .filter((r) => r.editUrl || DOC_EXISTS_STAGES.has(r.stage))
          .map((r) => r.editUrl ?? `https://da.live/edit#${r.path}`);
      case 'preview':
        return results.filter((r) => r.previewUrl).map((r) => r.previewUrl!);
      case 'live':
        return results.filter((r) => r.liveUrl).map((r) => r.liveUrl!);
    }
  }

  function handleExportUrls(kind: UrlExportKind) {
    setShowExportMenu(false);
    const urls = collectUrls(kind);
    if (urls.length === 0) return; // options with 0 are disabled; this is a guard
    const label = { document: 'document', preview: 'preview', live: 'published-aem' }[kind];
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([`${urls.join('\n')}\n`], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label}-urls-${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Shared classes for the colored bulk-action buttons. `cursor-pointer` so they read as clickable;
  // disabled while any op runs.
  const btnBase =
    'rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {results.length > 0 && !running && (
          <button
            type="button"
            onClick={() => setResetModalOpen(true)}
            className="cursor-pointer rounded-lg border border-gray-200 bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200"
          >
            Reset results
          </button>
        )}

        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate || running || existenceChecking}
          className="w-max cursor-pointer rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {generating
            ? `Generating… ${counts.generated + counts.error} / ${results.length}`
            : `Generate ${selectedCount} ${selectedCount === 1 ? 'row' : 'rows'}`}
        </button>

        {showPreviewBtn && (
          <button
            type="button"
            onClick={handlePreview}
            disabled={running}
            className={`${btnBase} bg-indigo-600 hover:bg-indigo-700`}
          >
            {bulkOp === 'previewing'
              ? `Previewing… ${bulkDone()} / ${bulkTotal}`
              : `Preview ${counts.previewable} document${counts.previewable === 1 ? '' : 's'}`}
          </button>
        )}

        {showPublishBtn && (
          <button
            type="button"
            onClick={handlePublish}
            disabled={running}
            className={`${btnBase} bg-green-600 hover:bg-green-700`}
          >
            {bulkOp === 'publishing'
              ? `Publishing… ${bulkDone()} / ${bulkTotal}`
              : `Publish ${counts.publishable} document${counts.publishable === 1 ? '' : 's'}`}
          </button>
        )}

        {showUnpublishBtn && (
          <button
            type="button"
            onClick={handleUnpublish}
            disabled={running}
            className={`${btnBase} bg-red-600 hover:bg-red-700`}
          >
            {bulkOp === 'unpublishing'
              ? `Unpublishing… ${bulkDone()} / ${bulkTotal}`
              : `Unpublish ${counts.published} documents`}
          </button>
        )}

        {showDeleteBtn && (
          <button
            type="button"
            onClick={() => setDeleteModalOpen(true)}
            disabled={running}
            className={`${btnBase} bg-red-700 hover:bg-red-800`}
          >
            {bulkOp === 'deleting'
              ? `Deleting… ${bulkDone()} / ${bulkTotal}`
              : `Delete ${counts.deletable} documents`}
          </button>
        )}

        {results.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            {!running && (
              <p className="text-sm text-gray-500">
                {counts.generated > 0 && <span className="font-medium text-green-600">{counts.generated} generated </span>}
                {counts.previewed > 0 && <span className="font-medium text-indigo-600">{counts.previewed} previewed </span>}
                {counts.published > 0 && <span className="font-medium text-green-700">{counts.published} published </span>}
                {counts.error > 0 && <span className="font-medium text-red-600">{counts.error} error</span>}
              </p>
            )}
            <div ref={exportMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu((p) => !p)}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Export URLs
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-gray-400">
                  <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </button>
              {showExportMenu && (() => {
                const opts: { kind: UrlExportKind; label: string }[] = [
                  { kind: 'document', label: 'Document links' },
                  { kind: 'preview', label: 'Preview links (.aem.page)' },
                  { kind: 'live', label: 'Published (.aem.live)' },
                ];
                return (
                  <div className="absolute right-0 z-10 mt-1 w-60 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                    {opts.map(({ kind, label }, i) => {
                      const count = collectUrls(kind).length;
                      return (
                        <Fragment key={kind}>
                          {i > 0 && <div className="border-t border-gray-100" />}
                          <button
                            type="button"
                            disabled={count === 0}
                            onClick={() => handleExportUrls(kind)}
                            className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
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
        )}
      </div>

      {preview && previewRows.length > 0 && (
        <p className="text-sm text-gray-500">
          Showing output paths for {previewRows.length} document{previewRows.length === 1 ? '' : 's'} — click Generate to create them.
          {existingCount > 0 && (
            <span className="ml-1 font-medium text-amber-600">
              · {existingCount} already exist{existingCount === 1 ? 's' : ''} and will be updated.
            </span>
          )}
        </p>
      )}

      {showTable && (
        <div className="overflow-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Output path</th>
                <th className="px-3 py-2 font-medium">Doc</th>
                <th className="px-3 py-2 font-medium">Preview</th>
                <th className="px-3 py-2 font-medium">Publish</th>
                <th className="px-3 py-2 font-medium">QA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview
                ? previewRows.map((pr, i) => (
                    <tr key={pr.id} className="opacity-60">
                      <td className="px-3 py-1.5 text-xs tabular-nums text-gray-500">{i + 1}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        <span className="inline-flex items-center gap-2">
                          {existenceStatus[pr.path] === 'exists' ? (
                            <a
                              href={`https://da.live/edit#${pr.path}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-amber-600 hover:underline"
                            >
                              {pr.path}
                              <ExternalLinkIcon />
                            </a>
                          ) : (
                            <span className="text-gray-700">{pr.path}</span>
                          )}
                          <ExistenceBadge status={existenceStatus[pr.path]} />
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-300">—</td>
                      <td className="px-3 py-1.5 text-xs text-gray-300">—</td>
                      <td className="px-3 py-1.5 text-xs text-gray-300">—</td>
                      <td className="px-3 py-1.5 text-xs text-gray-300">—</td>
                    </tr>
                  ))
                : results.map((r, i) => (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="px-3 py-1.5 text-xs tabular-nums text-gray-500">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-gray-700">
                          <span className="inline-flex items-center gap-2">
                            {r.editUrl ? (
                              <a
                                href={r.editUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                              >
                                {r.path}
                                <ExternalLinkIcon />
                              </a>
                            ) : (
                              r.path
                            )}
                            <ExistenceOutcomeBadge status={existenceStatus[r.path]} />
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <GeneratePill result={r} onGenerate={() => {}} onDelete={() => actions.deleteRow(r)} />
                        </td>
                        <td className="px-3 py-1.5">
                          <PreviewPill result={r} onPreview={() => actions.previewRow(r)} />
                        </td>
                        <td className="px-3 py-1.5">
                          <PublishPill
                            result={r}
                            onPublish={() => actions.publishRow(r)}
                            onUnpublish={() => actions.unpublishRow(r)}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <QaIssueBadge qa={r.qa} expanded={expanded.has(r.id)} onToggle={() => toggle(r.id)} />
                        </td>
                      </tr>
                      {expanded.has(r.id) && r.qa && (
                        <tr className="bg-gray-50">
                          <td colSpan={6} className="px-3 py-2">
                            <ul className="flex flex-col gap-1 text-xs">
                              {r.qa.checks.map((c) => (
                                <li key={c.id} className={c.pass ? 'text-green-700' : 'text-amber-700'}>
                                  {c.pass ? '✓' : '⚠'} <span className="font-medium">{c.label}:</span> {c.description}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {resetModalOpen && (
        <ConfirmModal
          title="Reset results?"
          confirmLabel="Reset"
          confirmClassName="cursor-pointer rounded-xl bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900"
          onCancel={() => setResetModalOpen(false)}
          onConfirm={handleReset}
        >
          <p className="max-w-md text-sm text-gray-500">
            This clears all {results.length} result{results.length === 1 ? '' : 's'} from this view. Documents
            already written to DA are not deleted — use Delete to remove them first.
          </p>
        </ConfirmModal>
      )}

      {deleteModalOpen && (
        <ConfirmModal
          title={`Delete ${counts.deletable} document${counts.deletable === 1 ? '' : 's'}?`}
          confirmLabel="Delete"
          onCancel={() => setDeleteModalOpen(false)}
          onConfirm={handleBulkDelete}
        >
          <p className="text-sm text-gray-500">This permanently deletes the following documents from DA:</p>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-gray-100 p-3 font-mono text-xs text-gray-700">
            {results
              .filter((r) => DELETABLE_STAGES.includes(r.stage))
              .map((r) => (
                <li key={r.id} className="whitespace-nowrap">{r.path}</li>
              ))}
          </ul>
        </ConfirmModal>
      )}
    </section>
  );
}
