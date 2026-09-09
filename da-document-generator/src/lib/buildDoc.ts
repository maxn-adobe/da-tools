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
 * Normalize a value into a DA document name so the path we build matches exactly what DA stores and
 * serves. DA's delivery keeps only lowercase a-z / 0-9 / dash (aem.live/docs/limits): every other run
 * of characters collapses to a single dash, then leading/trailing dashes are trimmed. Pre-sanitizing
 * here (rather than letting DA transform it after the POST) keeps our edit/preview/publish links from
 * 404ing against the real, normalized page.
 */
export function sanitizeDocName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve a row's DA output path: a fixed output directory + a per-row document name taken from a
 * data column, sanitized to DA's rules (falls back to `doc-<_id>` when the column is empty or has no
 * usable characters). The whole path is lowercased to mirror da-admin, which lowercases stored paths.
 * Returns '' if no directory.
 */
export function resolveOutputPath(row: CsvRow, cfg: OutputConfig): string {
  const dir = cfg.outputDir.trim().replace(/\/+$/, '');
  if (!dir) return '';
  const name = sanitizeDocName((row[cfg.slugColumn] ?? '').trim()) || `doc-${row['_id']}`;
  return `${dir}/${name}`.toLowerCase();
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
export function buildBakedDoc(templateHtml: string, row: CsvRow, opts: { generatedBatch: string }): string {
  const substituted = applyTemplate(templateHtml, row);
  const doc = new DOMParser().parseFromString(substituted, 'text/html');
  resolveHashLinksOnDoc(doc, row);

  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '_id') continue;
    entries[key] = value;
  }
  entries['sheet-powered'] = 'N';
  // Stamp the generation batch (one shared ISO timestamp per Generate run — a batch identity) plus a
  // per-doc last-updated, matching pdp-document-generator's convention so a Document Manager Batch
  // filter can group these docs. `generated-batch` must never be re-bumped by a later edit.
  entries['generated-batch'] = opts.generatedBatch;
  entries['last-updated'] = new Date().toISOString();
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
