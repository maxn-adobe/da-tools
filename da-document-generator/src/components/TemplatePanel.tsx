import type { TemplateState } from '../types';
import { urlToSourcePath } from '../api/daApi';
import { ExternalLinkIcon } from './StatusPills';

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none';

interface Props {
  columns: string[];
  template: TemplateState;
  onTemplatePathChange: (p: string) => void;
}

export default function TemplatePanel({ columns, template, onTemplatePathChange }: Props) {
  const v = template.validation;
  const err = template.error;
  // "Valid" = template loaded + usable (has <main>); a 'warning' still counts. Any fetch error → invalid.
  const valid = v ? v.status === 'ready' || v.status === 'warning' : false;

  // Coverage is only meaningful once data is uploaded (App derives `columns` from the data rows).
  const hasData = columns.length > 0;
  const columnSet = new Set(columns);
  const matched = v ? columns.filter((c) => v.placeholders.includes(c)).length : 0;

  // Keep the result card mounted for both success and error, so a bad path doesn't wipe the section.
  const showCard = !template.loading && (v || err);

  return (
    <section className="flex flex-col gap-3">
      <label className="text-sm font-medium text-gray-800">Template document (DA path or URL)</label>
      <input
        className={inputCls}
        placeholder="/adobecom/da-express-milo/es/express/colors/default"
        value={template.path}
        onChange={(e) => onTemplatePathChange(e.target.value)}
      />

      {template.loading && <p className="text-sm text-gray-500">Validating…</p>}

      {showCard && (
        <div
          className={`flex flex-col gap-3 rounded-lg border p-3 ${
            valid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          }`}
        >
          {/* Top-left: Valid / Invalid pill, inline with a link to the template document */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                valid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {valid ? 'Valid' : 'Invalid'}
            </span>
            <a
              href={`https://da.live/edit#${urlToSourcePath(template.path)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 break-all font-mono text-xs text-gray-500 hover:text-blue-600"
            >
              {template.path}
              <ExternalLinkIcon />
            </a>
          </div>

          {v ? (
            <>
              <p className="text-sm text-gray-600">
                {hasData
                  ? `${matched} of ${columns.length} column${columns.length === 1 ? '' : 's'} map to a template placeholder.`
                  : `${v.placeholders.length} placeholder token${v.placeholders.length === 1 ? '' : 's'}`}
                {v.issues.length > 0 && <span className="text-gray-500"> — {v.issues.join('; ')}</span>}
              </p>

              <div className="flex flex-wrap gap-1.5">
                {v.placeholders.map((p) => {
                  const cls = !hasData
                    ? 'bg-gray-100 text-gray-600 border-gray-200'
                    : columnSet.has(p)
                    ? 'bg-green-100 text-green-700 border-green-200'
                    : 'bg-amber-100 text-amber-700 border-amber-200';
                  return (
                    <span key={p} className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${cls}`}>
                      {p}
                    </span>
                  );
                })}
              </div>

              {/* Legend — colored swatches (no color names, no '='). Only meaningful once data is uploaded. */}
              {hasData && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                  <span className="flex items-center gap-1.5">
                    <Swatch className="bg-green-400" /> matching data column
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Swatch className="bg-amber-400" /> in template, missing from your data
                  </span>
                </div>
              )}
            </>
          ) : (
            /* Fetch error — show the code + message where the tokens would go. */
            <ErrorRow error={err ?? ''} />
          )}
        </div>
      )}
    </section>
  );
}

function ErrorRow({ error }: { error: string }) {
  const m = error.match(/^(\d{3}):\s*(.*)$/s);
  const code = m ? m[1] : null;
  const message = m ? m[2] : error;
  return (
    <div className="flex items-start gap-2 text-sm text-red-700">
      {code && (
        <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-red-700">
          {code}
        </span>
      )}
      <span className="break-words">{message}</span>
    </div>
  );
}

function Swatch({ className }: { className: string }) {
  return <span className={`inline-block h-3 w-3 shrink-0 rounded-sm ${className}`} />;
}
