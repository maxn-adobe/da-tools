export const DEFAULT_CONCURRENCY = 3;

// Generate step (build → write to DA source). DA's source API (admin.da.live) tolerates far more than
// the AEM admin API, and postDoc/createDocVersion retry on 429/5xx (fetchWithRetry), so a transient
// throttle won't drop rows. Fixed at 24 (the tuned sweet spot) — the former user-adjustable "Write
// concurrency" control in the Generate panel was removed.
export const GENERATE_CONCURRENCY = 24;

// Higher bound for the Document Manager scan (crawl + per-doc source fetch). Tunable:
// peak in-flight ≈ CRAWL_CONCURRENCY + STATUS_CONCURRENCY while fetch and status overlap.
export const CRAWL_CONCURRENCY = 6;

// The AEM admin status API (admin.hlx.page) rate-limits harder than DA's source API, so
// status checks run at a gentler concurrency and retry on 429 (see checkPageStatus).
export const STATUS_CONCURRENCY = 4;

// Pre-generation existing-document check. Directory listing is the primary path (one request per
// output dir); this bounds the per-path HEAD fallback used only when a listing fails. DA's source
// API tolerates far more than the AEM admin API, so probe well above DEFAULT_CONCURRENCY.
export const EXISTENCE_CHECK_CONCURRENCY = 20;

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
