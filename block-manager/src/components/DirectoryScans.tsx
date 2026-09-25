import type { DirPart } from '../types';

interface Props {
  dirs: string[];
  dirParts: Record<string, DirPart>;
  dirCounts: Record<string, number | 'counting'>;
  busy: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  onScanDir: (dir: string) => void;
}

interface RowInfo { button: string; meta: string; dim: boolean; scanning: boolean }

function rowInfo(data: DirPart, count: number | 'counting' | undefined): RowInfo {
  if (data === 'scanning') return { button: '…', meta: 'scanning…', dim: false, scanning: true };
  if (data) {
    return {
      button: `Rescan ${data.docCount.toLocaleString()} docs`,
      meta: `scanned ${new Date(data.scannedAt).toLocaleDateString()}`,
      dim: false,
      scanning: false,
    };
  }
  // Never scanned — show the up-front count when we have it (or are computing it).
  if (typeof count === 'number') {
    return { button: `Scan ${count.toLocaleString()} docs`, meta: 'never scanned', dim: true, scanning: false };
  }
  if (count === 'counting') return { button: 'Scan', meta: 'counting…', dim: true, scanning: false };
  return { button: 'Scan', meta: 'never scanned', dim: true, scanning: false };
}

export function DirectoryScans({
  dirs, dirParts, dirCounts, busy, open, onToggle, onScanDir,
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
              <button className="dir-btn" disabled={busy} onClick={() => onScanDir(dir)}>
                {info.button}
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
