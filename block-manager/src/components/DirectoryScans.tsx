import { useEffect, useRef } from 'react';
import type { DirPart } from '../types';

interface Props {
  dirs: string[];
  dirParts: Record<string, DirPart>;
  dirCounts: Record<string, number | 'counting'>;
  busy: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  selected: Set<string>;
  onToggleDir: (dir: string) => void;
  onToggleAll: (checked: boolean) => void;
  onScanSelected: () => void;
  onCountSelected: () => void;
}

function rowMeta(data: DirPart, count: number | 'counting' | undefined): { meta: string; dim: boolean } {
  if (data === 'scanning') return { meta: 'scanning…', dim: false };
  if (data) {
    return {
      meta: `scanned ${new Date(data.scannedAt).toLocaleDateString()} · ${data.docCount.toLocaleString()} docs`,
      dim: false,
    };
  }
  if (count === 'counting') return { meta: 'counting…', dim: true };
  if (typeof count === 'number') return { meta: `${count.toLocaleString()} docs · not scanned`, dim: true };
  return { meta: 'never scanned', dim: true };
}

function label(verb: string, n: number): string {
  if (n === 0) return `${verb} directories`;
  return `${verb} ${n} director${n === 1 ? 'y' : 'ies'}`;
}

export function DirectoryScans({
  dirs, dirParts, dirCounts, busy, open, onToggle,
  selected, onToggleDir, onToggleAll, onScanSelected, onCountSelected,
}: Props) {
  const n = selected.size;
  const allSelected = dirs.length > 0 && dirs.every((d) => selected.has(d));
  const someSelected = n > 0 && !allSelected;

  const headRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <details id="dir-details" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>Directory Scans</summary>

      <div className="dir-actions">
        <button className="dir-btn" disabled={busy || n === 0} onClick={onScanSelected}>
          {label('Scan', n)}
        </button>
        <button className="dir-btn" disabled={busy || n === 0} onClick={onCountSelected}>
          {label('Count', n)}
        </button>
        <span className="dir-selected">{n} selected</span>
      </div>

      <div id="dir-list">
        <div className="dir-row dir-head">
          <input
            ref={headRef}
            type="checkbox"
            checked={allSelected}
            disabled={busy || dirs.length === 0}
            onChange={(e) => onToggleAll(e.target.checked)}
            aria-label="Select all directories"
          />
          <span className="dir-name dir-head-label">directory</span>
          <span className="dir-meta" />
        </div>
        {dirs.map((dir) => {
          const info = rowMeta(dirParts[dir], dirCounts[dir]);
          return (
            <label className="dir-row" key={dir}>
              <input
                type="checkbox"
                checked={selected.has(dir)}
                disabled={busy}
                onChange={() => onToggleDir(dir)}
                aria-label={`Select ${dir}`}
              />
              <span className="dir-name">{dir}</span>
              <span className={`dir-meta${info.dim ? ' dim' : ''}`}>{info.meta}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
