import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { CsvRow } from '../types';

/** Coerce arbitrary parsed rows into CsvRow (string values, trimmed keys) + a synthetic _id. */
function withIds(rows: Record<string, unknown>[]): CsvRow[] {
  return rows.map((r, i) => {
    const out: CsvRow = { _id: String(i) };
    for (const [k, v] of Object.entries(r)) {
      const key = k.trim();
      if (key === '_id') continue;
      out[key] = v == null ? '' : String(v);
    }
    return out;
  });
}

/** Parse a JSON string: either an array of objects, or a DA sheet shape `{ data: [...] }`. */
export function parseJson(text: string): CsvRow[] {
  const parsed: unknown = JSON.parse(text);
  let rows: unknown;
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)) {
    rows = (parsed as { data: unknown[] }).data;
  }
  if (!Array.isArray(rows)) {
    throw new Error('JSON must be an array of objects or a DA sheet ({ "data": [...] }).');
  }
  return withIds(rows as Record<string, unknown>[]);
}

function parseXlsx(buf: ArrayBuffer): CsvRow[] {
  const wb = XLSX.read(buf, { type: 'array' });
  const first = wb.SheetNames[0];
  const sheet = wb.Sheets[first];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  return withIds(rows);
}

function parseCsv(file: File): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => resolve(withIds(res.data)),
      error: (err: Error) => reject(err),
    });
  });
}

/** Parse a user-supplied data file by extension: .json, .xlsx/.xls, or CSV (default). */
export async function parseDataFile(file: File): Promise<CsvRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) return parseJson(await file.text());
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseXlsx(await file.arrayBuffer());
  return parseCsv(file);
}
