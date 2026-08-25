import type { Dispatch, SetStateAction } from 'react';
import type { OutputState } from '../types';

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none';

interface Props {
  columns: string[];
  output: OutputState;
  setOutput: Dispatch<SetStateAction<OutputState>>;
}

export default function OutputPanel({ columns, output, setOutput }: Props) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={output.source === 'column'}
            onChange={() => setOutput((o) => ({ ...o, source: 'column' }))}
          />
          From a path column
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={output.source === 'dir'}
            onChange={() => setOutput((o) => ({ ...o, source: 'dir' }))}
          />
          Fixed directory + slug column
        </label>
      </div>

      {output.source === 'column' ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Path column
            <select
              className={inputCls}
              value={output.pathColumn}
              onChange={(e) => setOutput((o) => ({ ...o, pathColumn: e.target.value }))}
            >
              <option value="">— select —</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Org/repo prefix
            <input
              className={inputCls}
              value={output.prefix}
              onChange={(e) => setOutput((o) => ({ ...o, prefix: e.target.value }))}
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Output directory (DA path)
            <input
              className={inputCls}
              placeholder="/adobecom/da-express-milo/drafts/colors-migration"
              value={output.outputDir}
              onChange={(e) => setOutput((o) => ({ ...o, outputDir: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Slug column
            <select
              className={inputCls}
              value={output.slugColumn}
              onChange={(e) => setOutput((o) => ({ ...o, slugColumn: e.target.value }))}
            >
              <option value="">— select —</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      )}
    </section>
  );
}
