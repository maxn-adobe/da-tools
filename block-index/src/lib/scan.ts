import { ls, cat, collectDocs } from '../api/daApi';
import { fetchGitHubDirNames } from '../api/github';
import { BATCH_SIZE } from './config';
import type {
  RepoConfig, RepoBlocks, AuditRecord, DirPart, MergedData, SortKey,
} from '../types';

// Extract the block names used in a DA document's HTML: the first class of each
// `main > div > div[class]`, and the first cell of each `main > div > table`.
export function extractBlocks(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = new Set<string>();

  for (const div of doc.querySelectorAll('main > div > div[class]')) {
    const firstClass = div.className.trim().toLowerCase().split(/\s+/)[0];
    if (firstClass) blocks.add(firstClass);
  }

  for (const table of doc.querySelectorAll('main > div > table')) {
    const firstCell = table.querySelector('tr:first-child th, tr:first-child td');
    if (firstCell && firstCell.textContent) {
      const text = firstCell.textContent.trim().toLowerCase().split(/[\s(,]/)[0];
      if (text) blocks.add(text);
    }
  }

  return [...blocks];
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
  let docCount = 0;
  let scanErrors = 0;

  for (const part of parts) {
    docCount += part.docCount;
    scanErrors += part.scanErrors || 0;
    for (const [block, paths] of Object.entries(part.blocks)) {
      if (!blocks[block]) blocks[block] = [];
      blocks[block].push(...paths);
    }
  }

  const publishedPaths = parts.flatMap((p) => p.publishedPaths || []);

  return {
    blocks,
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
        for (const name of extractBlocks(html)) {
          if (!blocks[name]) blocks[name] = [];
          blocks[name].push(path);
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
  };
}
