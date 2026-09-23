export const DEFAULT_CONCURRENCY = 3;

// Generate step (template fetch → build → write to DA source). DA's source API (admin.da.live)
// tolerates far more than the AEM admin API, and postDoc/createDocVersion retry on 429/5xx
// (fetchWithRetry), so a transient throttle won't drop rows. This is the DEFAULT for the Generate
// panel's user-adjustable "Write concurrency" control — tune it live against DA's real write limit.
export const GENERATE_CONCURRENCY = 12;

// Higher bound for the Document Manager scan (crawl + per-doc source fetch). Tunable:
// peak in-flight ≈ CRAWL_CONCURRENCY + STATUS_CONCURRENCY while fetch and status overlap.
export const CRAWL_CONCURRENCY = 6;

// The AEM admin status API (admin.hlx.page) rate-limits harder than DA's source API, so
// status checks run at a gentler concurrency and retry on 429 (see checkPageStatus).
export const STATUS_CONCURRENCY = 4;

// Generate-tab pre-flight existing-document check. Directory listing is the primary path (one
// request per output dir); this bounds the per-path HEAD fallback used only when a listing fails.
// DA's source API tolerates far more than the AEM admin API, so probe well above DEFAULT_CONCURRENCY
// (mirrors HEAD_BATCH_SIZE in daApi.ts).
export const EXISTENCE_CHECK_CONCURRENCY = 20;

// GMC submit-dialog preview assembly (Zazzle template + pricing per doc). Each doc is two
// sequential Zazzle calls, so peak in-flight Zazzle requests ≈ this value. Set well above
// DEFAULT_CONCURRENCY because previewing a large selection (~1k+ published docs) is otherwise
// painfully slow, but kept moderate to stay under the browser's per-host socket cap and avoid
// tripping Zazzle rate limits. Tune here if Zazzle pushes back.
export const GMC_ASSEMBLE_CONCURRENCY = 12;

// Generate-tab "Validate Product IDs" / "Hydrate from Zazzle" over a large URN list (up to several
// thousand). Bounded — instead of an unbounded Promise.all — to stay under the browser's concurrent-
// request cap (which otherwise fails the overflow with ERR_INSUFFICIENT_RESOURCES) and Zazzle's rate
// limit. Combined with fetchProductFromTemplate's 429 retry, one click resolves the whole list.
// Tune here if Zazzle pushes back.
export const ZAZZLE_LOOKUP_CONCURRENCY = 8;

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
