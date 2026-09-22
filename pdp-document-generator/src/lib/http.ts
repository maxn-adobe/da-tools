import { sleep } from './concurrency';

export interface RetryOptions {
  /** Max total attempts, including the first. Default 4. */
  maxAttempts?: number;
  /** Base backoff in ms; grows as baseDelayMs * 2 ** attempt. Default 500. */
  baseDelayMs?: number;
  /** Which responses warrant a retry. Default: HTTP 429 or any 5xx. */
  retryOn?: (resp: Response) => boolean;
}

const DEFAULT_RETRY_ON = (resp: Response): boolean => resp.status === 429 || resp.status >= 500;

/**
 * `fetch()` with bounded retry + backoff on transient HTTP responses (429 / 5xx by default).
 *
 * Retries are triggered ONLY by HTTP status — a thrown network/CORS error propagates on the first
 * attempt. This mirrors the tool's existing retriers (checkPageStatus, the Zazzle helpers), which
 * fail fast on network errors because an unreachable origin won't recover by retrying, and at scale
 * retrying it is catastrophically slow. Honors a `Retry-After` response header (seconds) when
 * present, else exponential backoff with jitter.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const retryOn = opts.retryOn ?? DEFAULT_RETRY_ON;

  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(input, init);
    if (attempt >= maxAttempts - 1 || !retryOn(resp)) return resp;
    const retryAfter = Number(resp.headers.get('retry-after'));
    const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : baseDelayMs * 2 ** attempt;
    await sleep(backoffMs + Math.random() * 300);
  }
}
