import { useState, type ChangeEvent } from 'react';
import type { CsvRow } from '../types';
import { parseDataFile } from '../lib/parseData';

interface Props {
  rows: CsvRow[];
  fileName: string;
  selectedIds: Set<string>;
  onLoaded: (rows: CsvRow[], fileName: string) => void;
  onSelectionChange: (ids: Set<string>) => void;
}

export default function DataUpload({ rows, fileName, selectedIds, onLoaded, onSelectionChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseDataFile(file);
      if (parsed.length === 0) throw new Error('No rows found in the file.');
      onLoaded(parsed, file.name);
      onSelectionChange(new Set(parsed.map((r) => r._id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsing(false);
    }
  }

  const columns = rows.length ? Object.keys(rows[0]).filter((k) => k !== '_id') : [];
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r._id));

  function toggleAll() {
    onSelectionChange(allSelected ? new Set() : new Set(rows.map((r) => r._id)));
  }
  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  return (
    <section className="flex flex-col gap-3">
      <label className="inline-flex w-max cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400">
        {parsing ? 'Parsing…' : rows.length ? 'Replace data file' : 'Choose data file (CSV / XLSX / JSON)'}
        <input
          type="file"
          accept=".csv,.tsv,.xlsx,.xls,.json"
          className="hidden"
          onChange={handleFile}
          disabled={parsing}
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {rows.length > 0 && (
        <>
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{fileName}</span> — {rows.length} rows,{' '}
            {columns.length} columns · <span className="font-medium">{selectedIds.size} selected</span>
          </p>
          <div className="max-h-96 overflow-auto rounded-lg border border-gray-200">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-600">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </th>
                  {columns.map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r._id} className={selectedIds.has(r._id) ? 'bg-blue-50/40' : ''}>
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r._id)}
                        onChange={() => toggleOne(r._id)}
                      />
                    </td>
                    {columns.map((c) => (
                      <td key={c} className="max-w-[220px] truncate px-3 py-1.5 text-gray-700" title={r[c]}>
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
