import { ls, cat, collectDocs } from '../api/daApi';
import { fetchGitHubDirNames } from '../api/github';
import { BATCH_SIZE } from './config';
import type {
  RepoConfig, RepoBlocks, AuditRecord, DirPart, MergedData, SortKey,
} from '../types';

// The bucket a variant-less block instance is filed under.
export const NO_VARIANT = '(none)';

// Extract the blocks used in a DA document's HTML, each with the set of variant tokens present.
// A block is the first class of each `main > div > div[class]`, or the first cell of each
// `main > div > table`; its variant is the remaining classes / the parenthetical tokens, split
// into individual tokens (per user decision). An instance carrying no variant contributes
// NO_VARIANT. Returns, per block name, the union of variant tokens seen across that block's
// instances in this one document.
export function extractBlockVariants(html: string): Map<string, Set<string>> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = new Map<string, Set<string>>();

  const record = (name: string, tokens: string[]) => {
    if (!name) return;
    let set = out.get(name);
    if (!set) { set = new Set<string>(); out.set(name, set); }
    if (tokens.length === 0) set.add(NO_VARIANT);
    else for (const t of tokens) set.add(t);
  };

  // Decorated div-grid form: `<div class="marquee large light">` -> name "marquee", variants large,light.
  for (const div of doc.querySelectorAll('main > div > div[class]')) {
    const classes = div.className.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const [name, ...rest] = classes;
    record(name, rest.filter((c) => c !== 'block'));
  }

  // Source table form: first cell `Marquee (large, light)` -> name "marquee", variants large,light.
  for (const table of doc.querySelectorAll('main > div > table')) {
    const firstCell = table.querySelector('tr:first-child th, tr:first-child td');
    const raw = firstCell?.textContent?.trim().toLowerCase();
    if (!raw) continue;
    const name = raw.split(/[\s(,]/)[0];
    const paren = raw.match(/\(([^)]*)\)/)?.[1] ?? '';
    const tokens = paren.split(',').map((t) => t.trim()).filter(Boolean);
    record(name, tokens);
  }

  return out;
}

// Accept the current { own, milo } shape and the legacy { express, milo } / array shapes.
export function repoBlocksFromStored(stored: unknown): RepoBlocks {
  if (Array.isArray(stored)) return { own: new Set(stored as string[]), milo: new Set() };
  const s = (stored || {}) as { own?: string[]; milo?: string[]; express?: string[] };
  return {
    own: new Set(s.own || s.express || []),
    milo: new Set(s.milo || []),
  };
}

export function mergeAllParts(dirParts: Record<string, DirPart>): MergedData | null {
  const parts = Object.values(dirParts).filter((d): d is AuditRecord => !!d && d !== 'scanning');
  if (parts.length === 0) return null;

  const blocks: Record<string, string[]> = {};
  const variants: Record<string, Record<string, string[]>> = {};
  let docCount = 0;
  let scanErrors = 0;

  for (const part of parts) {
    docCount += part.docCount;
    scanErrors += part.scanErrors || 0;
    for (const [block, paths] of Object.entries(part.blocks)) {
      if (!blocks[block]) blocks[block] = [];
      blocks[block].push(...paths);
    }
    for (const [block, tokenMap] of Object.entries(part.variants || {})) {
      if (!variants[block]) variants[block] = {};
      const vt = variants[block];
      for (const [token, paths] of Object.entries(tokenMap)) {
        if (!vt[token]) vt[token] = [];
        vt[token].push(...paths);
      }
    }
  }

  const publishedPaths = parts.flatMap((p) => p.publishedPaths || []);

  return {
    blocks,
    variants,
    docCount,
    scanErrors,
    publishedPaths: publishedPaths.length ? publishedPaths : null,
  };
}

export function sortEntries(
  entries: [string, string[]][],
  ownBlocks: Set<string>,
  miloBlocks: Set<string>,
  sortKey: SortKey,
): [string, string[]][] {
  if (sortKey === 'alpha') {
    return entries.sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
  }
  if (sortKey === 'repo') {
    const rank = (name: string) => {
      if (ownBlocks.has(name)) return 0;
      if (miloBlocks.has(name)) return 1;
      return 2;
    };
    return entries.sort(([nameA, a], [nameB, b]) => {
      const dr = rank(nameA) - rank(nameB);
      if (dr !== 0) return dr;
      if (b.length !== a.length) return b.length - a.length;
      return nameA.localeCompare(nameB);
    });
  }
  return entries.sort(([nameA, a], [nameB, b]) => {
    if (b.length !== a.length) return b.length - a.length;
    return nameA.localeCompare(nameB);
  });
}

export async function fetchRepoBlocks(cfg: RepoConfig): Promise<RepoBlocks> {
  const [ownNames, miloNames] = await Promise.all([
    fetchGitHubDirNames(cfg.own.github),
    cfg.milo ? fetchGitHubDirNames(cfg.milo.github) : Promise.resolve([] as string[]),
  ]);
  return { own: new Set(ownNames), milo: new Set(miloNames) };
}

export async function fetchKitchenSinkBlocks(cfg: RepoConfig): Promise<RepoBlocks> {
  const toSet = (items: { ext?: string; path: string }[]) => new Set(
    items
      .filter((i) => i.ext === 'html')
      .map((i) => (i.path.split('/').pop() ?? '').replace(/\.html$/, '')),
  );
  const [ownList, miloList] = await Promise.all([
    ls(cfg.own.kitchenSink.lsPath).catch(() => []),
    cfg.milo ? ls(cfg.milo.kitchenSink.lsPath).catch(() => []) : Promise.resolve([]),
  ]);
  return { own: toSet(ownList), milo: toSet(miloList) };
}

// Scan one content directory: crawl its HTML docs, extract block usage, return the audit record.
// Progress is reported via onStatus; the caller persists the result.
export async function runScanForDir(
  cfg: RepoConfig,
  dirName: string,
  repoBlocks: RepoBlocks,
  onStatus: (msg: string) => void,
): Promise<AuditRecord> {
  const dirPath = `${cfg.scanRoot}/${dirName}`;
  const blocks: Record<string, string[]> = {};
  const variants: Record<string, Record<string, string[]>> = {};
  let scanned = 0;
  let errors = 0;

  const docs = await collectDocs(dirPath, (count) => {
    onStatus(`Scanning ${dirName}… ${count} documents found`);
  });

  onStatus(`Scanning ${dirName}… 0 / ${docs.length}`);

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const batchErrors = await Promise.all(batch.map(async (path): Promise<number> => {
      try {
        const html = await cat(path);
        for (const [name, tokenSet] of extractBlockVariants(html)) {
          if (!blocks[name]) blocks[name] = [];
          blocks[name].push(path);
          if (!variants[name]) variants[name] = {};
          const vt = variants[name];
          for (const token of tokenSet) {
            if (!vt[token]) vt[token] = [];
            vt[token].push(path);
          }
        }
        return 0;
      } catch {
        return 1;
      }
    }));
    errors += batchErrors.reduce((s, e) => s + e, 0);
    scanned += batch.length;
    const errStr = errors > 0 ? `, ${errors} error${errors !== 1 ? 's' : ''}` : '';
    onStatus(`Scanning ${dirName}… ${scanned} / ${docs.length}${errStr}`);
  }

  return {
    scannedAt: new Date().toISOString(),
    docCount: docs.length,
    scanErrors: errors,
    repoBlocks: { own: [...repoBlocks.own], milo: [...repoBlocks.milo] },
    blocks,
    variants,
  };
}
