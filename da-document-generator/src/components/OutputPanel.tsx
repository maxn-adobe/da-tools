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
    <section className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Output directory
        <input
          className={inputCls}
          placeholder="/adobecom/da-express-milo/drafts/colors-migration"
          value={output.outputDir}
          onChange={(e) => setOutput((o) => ({ ...o, outputDir: e.target.value }))}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Document name
        <select
          className={inputCls}
          value={output.slugColumn}
          onChange={(e) => setOutput((o) => ({ ...o, slugColumn: e.target.value }))}
        >
          <option value="">— select —</option>
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    </section>
  );
}
