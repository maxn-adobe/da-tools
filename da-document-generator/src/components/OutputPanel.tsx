import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { CsvRow, OutputState } from '../types';
import { checkDirectoryExists } from '../api/daApi';
import { resolveOutputPath } from '../lib/buildDoc';
import { ExternalLinkIcon } from './StatusPills';

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none';

interface Props {
  columns: string[];
  rows: CsvRow[];
  selectedRows: CsvRow[];
  output: OutputState;
  setOutput: Dispatch<SetStateAction<OutputState>>;
  onDirValidChange: (valid: boolean) => void;
}

interface DirState {
  loading: boolean;
  valid: boolean;
  error: string | null;
}

export default function OutputPanel({
  columns,
  rows,
  selectedRows,
  output,
  setOutput,
  onDirValidChange,
}: Props) {
  const [dir, setDir] = useState<DirState>({ loading: false, valid: false, error: null });

  // Live-validate the output directory (debounced) — the folder must already exist to generate.
  // Reports validity up so App can gate the Generate button. `cancelled` drops stale responses.
  useEffect(() => {
    const path = output.outputDir.trim();
    if (!path) {
      setDir({ loading: false, valid: false, error: null });
      onDirValidChange(false);
      return;
    }
    let cancelled = false;
    setDir((d) => ({ ...d, loading: true, error: null }));
    onDirValidChange(false); // not valid until re-confirmed
    const timer = setTimeout(async () => {
      const res = await checkDirectoryExists(path);
      if (cancelled) return;
      setDir({ loading: false, valid: res.valid, error: res.error ?? null });
      onDirValidChange(res.valid);
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output.outputDir]);

  // A Document-name column is only selectable if EVERY SELECTED row has a non-empty value —
  // guarantees a non-empty slug for every generated doc, so no separate validation is needed.
  // Recomputes as rows are checked/unchecked in the Data panel.
  const completeCols = useMemo(() => {
    const set = new Set<string>();
    if (selectedRows.length === 0) return set;
    for (const c of columns) {
      if (selectedRows.every((r) => (r[c] ?? '').trim() !== '')) set.add(c);
    }
    return set;
  }, [columns, selectedRows]);

  // A stable example row (a random selected row) so the "i.e." preview shows a real resulting path.
  // Re-picks only when the data / selection changes, not on every keystroke.
  const sampleRow = useMemo(() => {
    const pool = selectedRows.length ? selectedRows : rows;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }, [selectedRows, rows]);

  const examplePath = output.slugColumn && sampleRow ? resolveOutputPath(sampleRow, output) : '';

  return (
    <section className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Output directory
            <input
              className={inputCls}
              placeholder="/adobecom/da-express-milo/drafts/maxn/color-test"
              value={output.outputDir}
              onChange={(e) => setOutput((o) => ({ ...o, outputDir: e.target.value }))}
            />
          </label>
          {dir.loading && <p className="text-xs text-gray-400">Validating…</p>}
          {!dir.loading && (dir.valid || dir.error) && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  dir.valid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}
              >
                {dir.valid ? 'Valid' : 'Invalid'}
              </span>
              {dir.valid ? (
                <a
                  href={`https://da.live/#${output.outputDir}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 break-all font-mono text-xs text-gray-500 hover:text-blue-600"
                >
                  {output.outputDir}
                  <ExternalLinkIcon />
                </a>
              ) : (
                <span className="text-xs text-red-600">{dir.error}</span>
              )}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Document name
          <select
            className={inputCls}
            value={output.slugColumn}
            onChange={(e) => setOutput((o) => ({ ...o, slugColumn: e.target.value }))}
          >
            <option value="">— select —</option>
            {columns.map((c) => {
              const complete = completeCols.has(c);
              return (
                <option key={c} value={c} disabled={!complete}>
                  {c}{complete ? '' : ' — incomplete'}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {examplePath && (
        <p className="pl-2 text-xs text-gray-400">
          i.e. <span className="font-mono text-gray-500">{examplePath}</span>
        </p>
      )}
    </section>
  );
}
