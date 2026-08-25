import { applyTemplate } from './generate';
import { upsertMetadataBlockOnDoc, serializeDoc } from './metadata';
import { extractPlaceholders } from '../api/daApi';
import type { CsvRow, QaResult } from '../types';

// ---------------------------------------------------------------------------
// Output path resolution
// ---------------------------------------------------------------------------

export interface OutputConfig {
  outputDir: string;
  slugColumn: string;
}

/**
 * Resolve a row's DA output path: a fixed output directory + a per-row document name taken from a
 * data column (falls back to `doc-<_id>` when that column is empty). Returns '' if no directory.
 */
export function resolveOutputPath(row: CsvRow, cfg: OutputConfig): string {
  if (!cfg.outputDir.trim()) return '';
  const slug = (row[cfg.slugColumn] ?? '').trim() || `doc-${row['_id']}`;
  return `${cfg.outputDir.replace(/\/$/, '')}/${slug}`;
}

// ---------------------------------------------------------------------------
// Document construction
// ---------------------------------------------------------------------------

/**
 * BAKE: a self-contained static document that renders without the runtime content-replace.js
 * script. It (1) substitutes body {{tokens}} with real values, (2) resolves `#key` CTA links from
 * data, and (3) attaches a Metadata block carrying the row's fields (title/description/etc.) with
 * `sheet-powered` forced OFF — so EDS still emits the correct <head> metadata, but
 * content-replace.js does not run (the body is already filled).
 */
export function buildBakedDoc(templateHtml: string, row: CsvRow): string {
  const substituted = applyTemplate(templateHtml, row);
  const doc = new DOMParser().parseFromString(substituted, 'text/html');
  resolveHashLinksOnDoc(doc, row);

  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '_id') continue;
    entries[key] = value;
  }
  entries['sheet-powered'] = 'N';
  upsertMetadataBlockOnDoc(doc, entries);

  return serializeDoc(doc);
}

/**
 * Resolve `<a href="...#key">` links whose `#key` matches a data column to that column's value.
 * Ports content-replace.js's link-rewrite behavior to author time.
 */
function resolveHashLinksOnDoc(doc: Document, row: CsvRow): void {
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    const hashIdx = href.indexOf('#');
    if (hashIdx === -1) return;
    const key = href.slice(hashIdx + 1);
    const value = row[key];
    if (value != null && value.trim() !== '') a.setAttribute('href', value);
  });
}

// ---------------------------------------------------------------------------
// QA (informational)
// ---------------------------------------------------------------------------

/** BAKE QA: after substitution, report any {{tokens}} that had no matching data column. */
export function runBakeQa(builtHtml: string): QaResult {
  const leftover = extractPlaceholders(builtHtml);
  const pass = leftover.length === 0;
  return {
    pass,
    checks: [{
      id: 'unsubstituted-placeholders',
      label: 'Placeholder substitution',
      description: pass
        ? 'All template placeholders were replaced from your data.'
        : `No matching data column for: ${leftover.join(', ')}.`,
      pass,
    }],
  };
}
