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
 * Build one generated document from the template: (1) substitute the template's {{tokens}} —
 * anywhere in the HTML, including link URLs and its own authored Metadata block — with the row's
 * values, then (2) stamp `generated-batch` + `last-updated` into the Metadata block (creating one if
 * the template has none). Nothing else is rewritten or added: a data column only reaches the
 * document through a {{token}} the template references (e.g. a `title | {{title}}` Metadata row).
 */
export function buildBakedDoc(templateHtml: string, row: CsvRow, opts: { generatedBatch: string }): string {
  const substituted = applyTemplate(templateHtml, row);
  const doc = new DOMParser().parseFromString(substituted, 'text/html');

  // Stamp the generation batch (one shared ISO timestamp per Generate run — a batch identity) plus a
  // per-doc last-updated, matching pdp-document-generator's convention so a Document Manager Batch
  // filter can group these docs. `generated-batch` must never be re-bumped by a later edit.
  upsertMetadataBlockOnDoc(doc, {
    'generated-batch': opts.generatedBatch,
    'last-updated': new Date().toISOString(),
  });

  return serializeDoc(doc);
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
