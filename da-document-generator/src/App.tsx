import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CsvRow, ModeSelection, OutputState, RenderMode, RowResult, TemplateState } from './types';
import { cat, validateTemplate, docExists, postDoc, createDocVersion, getToken } from './api/daApi';
import { runBatch } from './lib/concurrency';
import {
  buildDoc,
  resolveOutputPath,
  withModeSegment,
  runBakeQa,
  runMetadataQa,
  type OutputConfig,
} from './lib/buildDoc';
import { useDaDocumentActions } from './hooks/useDaDocumentActions';
import TemplatePanel from './components/TemplatePanel';
import DataUpload from './components/DataUpload';
import OutputPanel from './components/OutputPanel';
import RenderModePanel from './components/RenderModePanel';
import GeneratePanel from './components/GeneratePanel';

const DEFAULT_TEMPLATE_PATH = '/adobecom/da-express-milo/es/express/colors/default';

export default function App() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState<TemplateState>({
    path: DEFAULT_TEMPLATE_PATH, html: null, validation: null, error: null, loading: false,
  });
  const [output, setOutput] = useState<OutputState>({
    source: 'column', pathColumn: 'url', prefix: '/adobecom/da-express-milo', outputDir: '', slugColumn: '',
  });
  const [mode, setMode] = useState<ModeSelection>('both');
  const [results, setResults] = useState<RowResult[]>([]);
  const [generating, setGenerating] = useState(false);

  const columns = useMemo(
    () => (rows.length ? Object.keys(rows[0]).filter((k) => k !== '_id') : []),
    [rows],
  );
  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r._id)), [rows, selectedIds]);

  const actions = useDaDocumentActions<RowResult>(setResults, { afterDelete: () => undefined });

  // Live-validate the template whenever its path changes (debounced) — replaces the Validate
  // button. Fires on mount for the default path. The `cancelled` guard drops stale responses.
  useEffect(() => {
    const path = template.path.trim();
    if (!path) {
      setTemplate((t) => ({ ...t, html: null, validation: null, error: null, loading: false }));
      return;
    }
    let cancelled = false;
    setTemplate((t) => ({ ...t, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const html = await cat(path);
        if (cancelled) return;
        setTemplate((t) => ({ ...t, html, validation: validateTemplate(html), loading: false }));
      } catch (err) {
        if (cancelled) return;
        setTemplate((t) => ({
          ...t, html: null, validation: null, loading: false,
          error: friendlyTemplateError(err),
        }));
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.path]);

  function toOutputConfig(): OutputConfig {
    return output.source === 'column'
      ? { source: 'column', pathColumn: output.pathColumn, prefix: output.prefix }
      : { source: 'dir', outputDir: output.outputDir, slugColumn: output.slugColumn };
  }

  const outputValid = output.source === 'column'
    ? !!output.pathColumn
    : !!output.outputDir && !!output.slugColumn;
  const canGenerate = !!template.html && selectedRows.length > 0 && outputValid && !generating;

  async function handleGenerate() {
    const token = getToken();
    const tmplHtml = template.html;
    if (!token || !tmplHtml) return;

    const modes: RenderMode[] = mode === 'both' ? ['bake', 'metadata'] : [mode];
    const cfg = toOutputConfig();

    const work: { id: string; row: CsvRow; mode: RenderMode; path: string }[] = [];
    for (const row of selectedRows) {
      const base = resolveOutputPath(row, cfg);
      if (!base) continue;
      for (const m of modes) {
        work.push({ id: `${row._id}:${m}`, row, mode: m, path: mode === 'both' ? withModeSegment(base, m) : base });
      }
    }

    setResults(work.map((w): RowResult => ({ id: w.id, path: w.path, mode: w.mode, stage: 'pending' })));
    setGenerating(true);
    const patch = (id: string, changes: Partial<RowResult>) =>
      setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));

    await runBatch(work, async (w) => {
      patch(w.id, { stage: 'generating' });
      try {
        const html = buildDoc(w.mode, tmplHtml, w.row);
        const qa = w.mode === 'bake' ? runBakeQa(html) : runMetadataQa(tmplHtml, w.row);
        if (await docExists(w.path)) {
          try { await createDocVersion(w.path, 'Pre-generation backup'); } catch { /* proceed */ }
        }
        const res = await postDoc(w.path, html);
        patch(w.id, { stage: 'generated', editUrl: res.source?.editUrl, qa });
      } catch (err) {
        patch(w.id, { stage: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    });

    setGenerating(false);
  }

  const noToken = !getToken();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 font-sans text-gray-900">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">DA Document Generator</h1>
        <p className="mt-1 text-sm text-gray-600">
          Populate the <code className="rounded bg-gray-100 px-1">{'{{placeholder}}'}</code> values of a DA template document with custom data from a spreadsheet or JSON and generate a document for each item / row.
        </p>
        {noToken && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No DA token — open this tool from da.live, or set <code>VITE_DA_TOKEN</code> for local dev.
          </p>
        )}
      </header>

      <Step n={1} title="Add Template">
        <TemplatePanel
          columns={columns}
          template={template}
          onTemplatePathChange={(p) => setTemplate((t) => ({ ...t, path: p }))}
        />
      </Step>

      <Step n={2} title="Add Data">
        <DataUpload
          rows={rows}
          fileName={fileName}
          placeholders={template.validation?.placeholders ?? []}
          selectedIds={selectedIds}
          onLoaded={(r, f) => { setRows(r); setFileName(f); }}
          onSelectionChange={setSelectedIds}
        />
      </Step>

      {rows.length > 0 && (
        <Step n={3} title="Output location">
          <OutputPanel columns={columns} output={output} setOutput={setOutput} />
        </Step>
      )}

      {rows.length > 0 && (
        <Step n={4} title="Render mode">
          <RenderModePanel mode={mode} setMode={setMode} />
        </Step>
      )}

      {rows.length > 0 && (
        <Step n={5} title="Generate & results">
          <GeneratePanel
            canGenerate={canGenerate}
            generating={generating}
            selectedCount={selectedRows.length}
            mode={mode}
            onGenerate={handleGenerate}
            results={results}
            actions={actions}
          />
        </Step>
      )}
    </div>
  );
}

/**
 * Map a template-fetch failure to "<code>: <friendly message>" (code kept so the panel can badge it).
 * Mirrors the PDP tool's TemplateOverridePanel error copy.
 */
function friendlyTemplateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.match(/^(\d{3}):\s*(.*)$/s);
  if (!m) return raw;
  const [, code, body] = m;
  if (code === '404') return '404: Template not found — check the path and confirm you have access.';
  if (code === '403') return "403: Access denied — confirm you're in the correct DA organization.";
  return `${code}: ${body || 'Unexpected error fetching the template.'}`;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-500">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[11px] text-white">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
