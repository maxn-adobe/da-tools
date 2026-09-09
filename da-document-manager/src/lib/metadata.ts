// Reader for the EDS authored Metadata block (`div.metadata`, rows of `key | value` divs).
// Copied from pdp-document-generator/src/lib/metadata.ts — only the reader; this tool never
// writes metadata, so the upsert/serialize helpers are intentionally omitted.
export function readMetadataBlockFromDoc(doc: Document): Record<string, string> {
  const block = doc.querySelector('div.metadata');
  if (!block) return {};
  const out: Record<string, string> = {};
  for (const row of Array.from(block.children)) {
    const key = row.children[0]?.textContent?.trim().toLowerCase();
    const value = row.children[1]?.textContent?.trim();
    if (key) out[key] = value ?? '';
  }
  return out;
}
