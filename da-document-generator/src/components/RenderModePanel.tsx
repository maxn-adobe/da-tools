import type { ModeSelection } from '../types';

interface Props {
  mode: ModeSelection;
  setMode: (m: ModeSelection) => void;
}

export default function RenderModePanel({ mode, setMode }: Props) {
  return (
    <section className="flex flex-col gap-1.5 text-sm">
      <label className="flex items-center gap-1.5">
        <input type="radio" checked={mode === 'bake'} onChange={() => setMode('bake')} />
        <span><b>Bake</b> — substitute values into the doc (self-contained, no runtime script)</span>
      </label>
      <label className="flex items-center gap-1.5">
        <input type="radio" checked={mode === 'metadata'} onChange={() => setMode('metadata')} />
        <span><b>Metadata</b> — attach a metadata block + <code>sheet-powered=Y</code> (content-replace fills at render)</span>
      </label>
      <label className="flex items-center gap-1.5">
        <input type="radio" checked={mode === 'both'} onChange={() => setMode('both')} />
        <span><b>Both</b> — write one doc per mode into <code>/baked/</code> and <code>/meta/</code> subfolders to compare</span>
      </label>
    </section>
  );
}
