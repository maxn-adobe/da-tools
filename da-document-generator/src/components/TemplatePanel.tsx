import type { TemplateState } from '../types';
import { urlToSourcePath } from '../api/daApi';
import { ExternalLinkIcon } from './StatusPills';

// Tokens the Express color block fills at runtime (mirrors content-replace.js's
// whitelist) — these are NOT populated from the user's data, so they get their
// own treatment instead of being shown as regular placeholders.
const BLOCK_FILLED = new Set(['type', 'quantity', 'heading_placeholder', 'prompt-text']);

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none';

interface Props {
  template: TemplateState;
  onTemplatePathChange: (p: string) => void;
}

export default function TemplatePanel({ template, onTemplatePathChange }: Props) {
  const v = template.validation;
  // "Valid" = the template is usable (has a <main>); a 'warning' (e.g. no tokens found) still counts.
  const valid = v ? v.status === 'ready' || v.status === 'warning' : false;

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
      {template.error && !template.loading && <p className="text-sm text-red-600">{template.error}</p>}

      {v && !template.loading && (
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

          <p className="text-sm text-gray-600">
            {v.placeholders.length} placeholder token{v.placeholders.length === 1 ? '' : 's'}
            {v.issues.length > 0 && <span className="text-gray-500"> — {v.issues.join('; ')}</span>}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {v.placeholders.map((p) => {
              const blockFilled = BLOCK_FILLED.has(p);
              const cls = blockFilled
                ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                : 'bg-gray-100 text-gray-600 border-gray-200';
              return (
                <span key={p} className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${cls}`}>
                  {p}
                </span>
              );
            })}
          </div>

          {/* Legend — colored swatches (no color names, no '='). Coverage against your
              data is reported in the Add Data step, once a file is uploaded. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <Swatch className="bg-gray-300" /> placeholder token (populated from your data)
            </span>
            <span className="flex items-center gap-1.5">
              <Swatch className="bg-indigo-400" /> filled by the page's block at runtime (not from your data)
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function Swatch({ className }: { className: string }) {
  return <span className={`inline-block h-3 w-3 shrink-0 rounded-sm ${className}`} />;
}
