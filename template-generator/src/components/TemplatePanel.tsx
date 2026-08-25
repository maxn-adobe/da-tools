import type { TemplateState } from '../types';

// Tokens the template-x block fills at runtime; not expected to come from data.
const BLOCK_FILLED = new Set(['type', 'quantity', 'heading_placeholder', 'prompt-text']);

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none';

interface Props {
  columns: string[];
  template: TemplateState;
  onTemplatePathChange: (p: string) => void;
}

export default function TemplatePanel({ columns, template, onTemplatePathChange }: Props) {
  const v = template.validation;

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
        <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm">
            Status:{' '}
            <span
              className={
                v.status === 'ready' ? 'font-medium text-green-700'
                : v.status === 'warning' ? 'font-medium text-amber-700'
                : 'font-medium text-red-700'
              }
            >
              {v.status}
            </span>
            {v.issues.length > 0 && <span className="text-gray-500"> — {v.issues.join('; ')}</span>}
            <span className="text-gray-400"> · {v.placeholders.length} placeholder tokens</span>
          </p>

          <div className="flex flex-wrap gap-1.5">
            {v.placeholders.map((p) => {
              const covered = columns.includes(p);
              const blockFilled = BLOCK_FILLED.has(p);
              const cls = blockFilled
                ? 'bg-gray-100 text-gray-500 border-gray-200'
                : covered
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-amber-50 text-amber-700 border-amber-200';
              return (
                <span key={p} className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${cls}`}>
                  {p}
                </span>
              );
            })}
          </div>

          {/* Legend — below the pills, colored swatches (no color names, no '=') */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <Swatch className="bg-green-400" /> matching data column
            </span>
            <span className="flex items-center gap-1.5">
              <Swatch className="bg-amber-400" /> no data column
            </span>
            <span className="flex items-center gap-1.5">
              <Swatch className="bg-gray-300" /> filled by the page's block at runtime (not from your data)
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
