import type { CsvRow, QaCheck, QaResult } from '../types';

/**
 * Substitute every `{{column}}` token in the template with the row's value for that column.
 * Uses literal split/join (not regex) so special characters in values are safe. The synthetic
 * `_id` column is skipped. Any column is substitutable — there is no allow-list.
 */
export function applyTemplate(templateHtml: string, row: CsvRow): string {
  let html = templateHtml;
  for (const [key, value] of Object.entries(row)) {
    if (key === '_id') continue;
    html = html.split(`{{${key}}}`).join(value);
  }
  return html;
}

/**
 * Post-publish QA on a fetched live page: presence of <title>, meta description, OG image,
 * and any leftover {{placeholder}} tokens. Informational (does not block).
 */
export function runPageQa(pageHtml: string): QaResult {
  const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
  const hasTitle = !!doc.querySelector('title')?.textContent?.trim();
  const hasDesc = !!doc.querySelector('meta[name="description"]')?.getAttribute('content');
  const hasOgImage = !!doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const unsubstituted = [...new Set([...pageHtml.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]))];

  const checks: QaCheck[] = [
    {
      id: 'missing-page-title',
      label: 'Page title',
      description: hasTitle ? 'The page has a <title> element.' : 'The page has no <title> element or it is empty.',
      pass: hasTitle,
    },
    {
      id: 'missing-meta-description',
      label: 'Meta description',
      description: hasDesc ? 'The page has a <meta name="description"> with content.' : 'The page has no <meta name="description"> with content.',
      pass: hasDesc,
    },
    {
      id: 'missing-og-image',
      label: 'OG image',
      description: hasOgImage ? 'The page has a <meta property="og:image"> with content.' : 'The page has no <meta property="og:image"> with content.',
      pass: hasOgImage,
    },
    {
      id: 'unsubstituted-placeholders',
      label: 'Placeholder substitution',
      description: unsubstituted.length === 0
        ? 'All template placeholders were replaced.'
        : `Leftover placeholders: ${unsubstituted.join(', ')}.`,
      pass: unsubstituted.length === 0,
    },
  ];
  return { pass: checks.every((c) => c.pass), checks };
}
