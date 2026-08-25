import { Fragment, useState } from 'react';
import type { ModeSelection, RowResult } from '../types';
import type { DaDocumentActions } from '../hooks/useDaDocumentActions';
import { GeneratePill, PreviewPill, PublishPill, QaIssueBadge } from './StatusPills';

interface Props {
  canGenerate: boolean;
  generating: boolean;
  selectedCount: number;
  mode: ModeSelection;
  onGenerate: () => void;
  results: RowResult[];
  actions: DaDocumentActions<RowResult>;
}

export default function GeneratePanel({
  canGenerate,
  generating,
  selectedCount,
  mode,
  onGenerate,
  results,
  actions,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const docsPerRow = mode === 'both' ? 2 : 1;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate || generating}
        className="w-max rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {generating
          ? 'Generating…'
          : `Generate ${selectedCount} ${selectedCount === 1 ? 'row' : 'rows'}${docsPerRow === 2 ? ' × 2 modes' : ''}`}
      </button>

      {results.length > 0 && (
        <div className="overflow-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Output path</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Doc</th>
                <th className="px-3 py-2 font-medium">Preview</th>
                <th className="px-3 py-2 font-medium">Publish</th>
                <th className="px-3 py-2 font-medium">QA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {results.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-700">
                      {r.editUrl ? (
                        <a href={r.editUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {r.path}
                        </a>
                      ) : (
                        r.path
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      <span className={r.mode === 'bake' ? 'text-purple-700' : 'text-teal-700'}>{r.mode}</span>
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
    </section>
  );
}
