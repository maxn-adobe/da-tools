export const DEFAULT_CONCURRENCY = 3;

// Higher bound for the Document Manager scan (directory crawl). Tunable: peak in-flight requests
// per crawl level ≈ CRAWL_CONCURRENCY.
export const CRAWL_CONCURRENCY = 6;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runBatch<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<void> {
  const queue = [...items];
  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      await fn(queue[idx++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
