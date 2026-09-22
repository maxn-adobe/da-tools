import type { DirPart } from '../types';

interface Props {
  dirs: string[];
  dirParts: Record<string, DirPart>;
  busy: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  onScanDir: (dir: string) => void;
}

function dirMeta(data: DirPart): { text: string; dim: boolean } {
  if (data === 'scanning') return { text: 'scanning…', dim: false };
  if (data) {
    return {
      text: `${data.docCount.toLocaleString()} docs · ${new Date(data.scannedAt).toLocaleDateString()}`,
      dim: false,
    };
  }
  return { text: 'never scanned', dim: true };
}

export function DirectoryScans({
  dirs, dirParts, busy, open, onToggle, onScanDir,
}: Props) {
  return (
    <details id="dir-details" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>Directory Scans</summary>
      <div id="dir-list">
        {dirs.map((dir) => {
          const data = dirParts[dir];
          const isScanning = data === 'scanning';
          const meta = dirMeta(data);
          return (
            <div className="dir-row" key={dir}>
              <span className="dir-name">{dir}</span>
              <span className={`dir-meta${meta.dim ? ' dim' : ''}`}>{meta.text}</span>
              <button className="dir-btn" disabled={busy} onClick={() => onScanDir(dir)}>
                {isScanning ? '…' : (data ? 'Rescan' : 'Scan')}
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
