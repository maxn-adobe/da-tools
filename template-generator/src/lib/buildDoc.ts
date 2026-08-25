import { applyTemplate } from './generate';
import { upsertMetadataBlockOnDoc, serializeDoc } from './metadata';
import { extractPlaceholders } from '../api/daApi';
import type { CsvRow, QaResult, RenderMode } from '../types';

/**
 * Tokens that appear in the color template but are intentionally NOT filled from data — the
 * `template-x` block resolves them at runtime. Leaving them literal is correct in both modes.
 */
const BLOCK_FILLED_TOKENS = new Set(['type', 'quantity', 'heading_placeholder', 'prompt-text']);

// ---------------------------------------------------------------------------
// Output path resolution
// ---------------------------------------------------------------------------

export type OutputConfig =
  | { source: 'column'; pathColumn: string; prefix: string }
  | { source: 'dir'; outputDir: string; slugColumn: string };

/**
 * Resolve a row's DA output path (`/org/repo/...`).
 * - `column`: take an explicit path from a data column (e.g. `url` = `/express/colors/pink`),
 *   prefixed with the org/repo (e.g. `/adobecom/da-express-milo`).
 * - `dir`: a fixed output directory + a slug column (falls back to `doc-<_id>`).
 * Returns '' if the required value is missing.
 */
export function resolveOutputPath(row: CsvRow, cfg: OutputConfig): string {
  if (cfg.source === 'column') {
    const raw = (row[cfg.pathColumn] ?? '').trim();
    if (!raw) return '';
    const rel = raw.startsWith('/') ? raw : `/${raw}`;
    const path = `${cfg.prefix.replace(/\/$/, '')}${rel}`;
    return path.replace(/\/{2,}/g, '/').replace(/\.html$/, '');
  }
  const slug = (row[cfg.slugColumn] ?? '').trim() || `doc-${row['_id']}`;
  return `${cfg.outputDir.replace(/\/$/, '')}/${slug}`;
}

/** Insert a segment before the final path element, e.g. (/a/b/pink, baked) -> /a/b/baked/pink. */
export function withModeSegment(path: string, segment: string): string {
  const i = path.lastIndexOf('/');
  if (i < 0) return `${segment}/${path}`;
  return `${path.slice(0, i)}/${segment}${path.slice(i)}`;
}

// ---------------------------------------------------------------------------
// Document construction
// ---------------------------------------------------------------------------

/**
 * BAKE mode: a self-contained static document that renders without the runtime
 * content-replace.js script. It (1) substitutes body {{tokens}} with real values,
 * (2) resolves `#key` CTA links from data, and (3) attaches a Metadata block carrying the
 * row's fields (title/description/etc.) with `sheet-powered` forced OFF — so EDS still emits
 * the correct <head> metadata, but content-replace.js does not run (the body is already filled).
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

/**
 * METADATA mode: leave {{tokens}} intact and attach a Metadata block carrying every data
 * column (+ `sheet-powered=Y`) so the existing content-replace.js fills the tokens at render —
 * exactly how the live color pages work today.
 */
export function buildMetadataDoc(templateHtml: string, row: CsvRow): string {
  const doc = new DOMParser().parseFromString(templateHtml, 'text/html');
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '_id') continue;
    entries[key] = value;
  }
  entries['sheet-powered'] = 'Y';
  upsertMetadataBlockOnDoc(doc, entries);
  return serializeDoc(doc);
}

export function buildDoc(mode: RenderMode, templateHtml: string, row: CsvRow): string {
  return mode === 'bake' ? buildBakedDoc(templateHtml, row) : buildMetadataDoc(templateHtml, row);
}

// ---------------------------------------------------------------------------
// Mode-aware QA (informational)
// ---------------------------------------------------------------------------

/** BAKE QA: after substitution, no data placeholders should remain (block-filled tokens excluded). */
export function runBakeQa(builtHtml: string): QaResult {
  const leftover = extractPlaceholders(builtHtml).filter((t) => !BLOCK_FILLED_TOKENS.has(t));
  const pass = leftover.length === 0;
  return {
    pass,
    checks: [{
      id: 'unsubstituted-placeholders',
      label: 'Placeholder substitution',
      description: pass
        ? 'All data placeholders were replaced (block-filled tokens like {{type}} left intentionally).'
        : `No matching data column for: ${leftover.join(', ')}.`,
      pass,
    }],
  };
}

/** METADATA QA: every template token (except block-filled ones) has a non-empty data column. */
export function runMetadataQa(templateHtml: string, row: CsvRow): QaResult {
  const tokens = extractPlaceholders(templateHtml).filter((t) => !BLOCK_FILLED_TOKENS.has(t));
  const missing = tokens.filter((t) => (row[t] ?? '').trim() === '');
  const pass = missing.length === 0;
  return {
    pass,
    checks: [{
      id: 'token-coverage',
      label: 'Token coverage',
      description: pass
        ? 'Every template token has a matching data column (content-replace will fill them at render).'
        : `No data (empty or absent) for tokens: ${missing.join(', ')}.`,
      pass,
    }],
  };
}
