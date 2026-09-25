import type { DirPart } from '../types';

interface Props {
  dirs: string[];
  dirParts: Record<string, DirPart>;
  dirCounts: Record<string, number | 'counting'>;
  busy: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  onScanDir: (dir: string) => void;
  onCountDir: (dir: string) => void;
}

interface RowInfo {
  meta: string;
  dim: boolean;
  scanLabel: string;
  countLabel: string;
}

function rowInfo(data: DirPart, count: number | 'counting' | undefined): RowInfo {
  const counting = count === 'counting';
  const counted = typeof count === 'number';
  const countLabel = counting ? 'counting…' : (counted ? 'Recount' : 'Count');

  if (data === 'scanning') {
    return { meta: 'scanning…', dim: false, scanLabel: '…', countLabel };
  }
  if (data) {
    return {
      meta: `scanned ${new Date(data.scannedAt).toLocaleDateString()}`,
      dim: false,
      scanLabel: `Rescan ${data.docCount.toLocaleString()} docs`,
      countLabel,
    };
  }
  // Never scanned — show the up-front count in the Scan button when we have it.
  const scanLabel = counted ? `Scan ${count.toLocaleString()} docs` : 'Scan';
  const meta = counting ? 'counting…' : (counted ? 'not scanned' : 'never scanned');
  return { meta, dim: true, scanLabel, countLabel };
}

export function DirectoryScans({
  dirs, dirParts, dirCounts, busy, open, onToggle, onScanDir, onCountDir,
}: Props) {
  return (
    <details id="dir-details" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>Directory Scans</summary>
      <div id="dir-list">
        {dirs.map((dir) => {
          const info = rowInfo(dirParts[dir], dirCounts[dir]);
          return (
            <div className="dir-row" key={dir}>
              <span className="dir-name">{dir}</span>
              <span className={`dir-meta${info.dim ? ' dim' : ''}`}>{info.meta}</span>
              <button className="dir-btn" disabled={busy} onClick={() => onCountDir(dir)}>
                {info.countLabel}
              </button>
              <button className="dir-btn" disabled={busy} onClick={() => onScanDir(dir)}>
                {info.scanLabel}
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
