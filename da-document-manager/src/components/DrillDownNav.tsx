import { Fragment } from 'react';

interface Props {
  /** Current drill path as folder segments (root = []). */
  segments: string[];
  /** Immediate child folders of the current level, with per-folder doc counts. */
  childFolders: { name: string; count: number }[];
  /** Jump the breadcrumb to `depth` segments (0 = root). */
  onNavigate: (depth: number) => void;
  /** Descend into a child folder. */
  onDrill: (name: string) => void;
}

// Sub-directory drill-down: a breadcrumb of the current folder path + clickable child folders.
// Shows one level at a time so it scales to arbitrarily deep/wide DA trees (unlike a flat dropdown
// of every folder). All path-derived — no network.
export default function DrillDownNav({ segments, childFolders, onNavigate, onDrill }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 flex-wrap text-sm">
        <span className="text-gray-500 mr-1">Folder:</span>
        <Crumb label="root" isCurrent={segments.length === 0} onClick={() => onNavigate(0)} />
        {segments.map((seg, i) => (
          <Fragment key={`${seg}-${i}`}>
            <span className="text-gray-300">›</span>
            <Crumb label={seg} isCurrent={i === segments.length - 1} onClick={() => onNavigate(i + 1)} />
          </Fragment>
        ))}
      </div>
      {childFolders.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {childFolders.map((child) => (
            <button
              key={child.name}
              type="button"
              onClick={() => onDrill(child.name)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-colors"
            >
              {child.name}
              <span className="text-gray-400">({child.count})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Crumb({ label, isCurrent, onClick }: { label: string; isCurrent: boolean; onClick: () => void }) {
  if (isCurrent) {
    return <span className="font-medium text-gray-900">{label}</span>;
  }
  return (
    <button type="button" onClick={onClick} className="text-blue-600 hover:underline cursor-pointer">
      {label}
    </button>
  );
}
