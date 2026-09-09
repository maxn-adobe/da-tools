import { listDirectory, type DaListItem } from './daApi';
import { runBatch, DEFAULT_CONCURRENCY } from '../lib/concurrency';

export interface CrawlError {
  dirPath: string;
  message: string;
}

export interface CrawlResult {
  docs: DaListItem[];
  errors: CrawlError[];
}

/**
 * Recursively lists every document under `rootPath`, walking one folder level at a time
 * with bounded concurrency per level (not an unbounded fan-out — a large tree shouldn't
 * slam the admin API with hundreds of simultaneous requests). A directory that fails to
 * list is recorded in `errors` and skipped; it never silently drops rows from the result.
 */
export async function crawlDirectory(
  rootPath: string,
  opts: { concurrency?: number; extensions?: string[] } = {},
): Promise<CrawlResult> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const extensions = new Set(opts.extensions ?? ['html']);
  const docs: DaListItem[] = [];
  const errors: CrawlError[] = [];

  let frontier = [rootPath];
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    await runBatch(frontier, async (dirPath) => {
      try {
        const items = await listDirectory(dirPath);
        for (const item of items) {
          if (item.ext === undefined) {
            nextFrontier.push(item.path);
          } else if (extensions.has(item.ext)) {
            docs.push(item);
          }
        }
      } catch (err) {
        errors.push({ dirPath, message: err instanceof Error ? err.message : String(err) });
      }
    }, concurrency);
    frontier = nextFrontier;
  }

  return { docs, errors };
}
