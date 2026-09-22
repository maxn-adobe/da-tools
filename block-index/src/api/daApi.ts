// DA (Document Authoring) admin REST client for block-index. Ported from the repo-root
// shared/da-api.js (still used by the static tools) into this tool's own TypeScript, following the
// Vite-tool convention: the token is a module-level singleton read via getToken(), not passed in.

export const DA_ADMIN = 'https://admin.da.live';

// aem.live is the public CDN for published AEM Edge Delivery content. HEAD requests need no auth,
// return no body (so no analytics JS fires), and have a 200 req/sec limit. No custom headers — any
// non-standard header triggers a CORS preflight (OPTIONS) that aem.live does not handle.
// Throttled to 10 concurrent / 500ms per batch (~20 req/sec) to be a polite client.
const STATUS_BATCH_SIZE = 10;
const STATUS_BATCH_MS = 500;
const LS_CONCURRENCY = 10;

export interface DaListItem {
  path: string;
  name?: string;
  ext?: string;
  lastModified?: number;
}

// --- Token store (module-level singleton; set once at startup by main.tsx) ---
let token: string | null = null;

export function getToken(): string | null {
  return token ?? import.meta.env.VITE_DA_TOKEN ?? null;
}

export function setToken(t: string | null): void {
  token = t;
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function daPathToLiveUrl(daPath: string): string {
  // /adobecom/da-express-milo/express/foo/bar.html -> https://main--da-express-milo--adobecom.aem.live/express/foo/bar
  const parts = daPath.split('/').filter(Boolean);
  const [org, repo, ...rest] = parts;
  const contentPath = `/${rest.join('/').replace(/\.html$/, '')}`;
  return `https://main--${repo}--${org}.aem.live${contentPath}`;
}

// Guard against accidental writes: only GET is allowed through this helper (reads).
export function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET') throw new Error(`Write operations are not permitted (attempted ${method} ${url})`);
  return fetch(url, { ...options, method: 'GET' });
}

export async function ls(path: string): Promise<DaListItem[]> {
  // The DA /list API is S3/R2-backed and lists ~1000 entries per folder at a time, returning a
  // `da-continuation-token` response header when truncated. Follow it until the whole folder is read.
  const items: DaListItem[] = [];
  let continuationToken: string | null = null;
  for (let guard = 0; guard < 1_000_000; guard += 1) {
    const headers: Record<string, string> = { ...authHeaders() };
    if (continuationToken) headers['da-continuation-token'] = continuationToken;
    // eslint-disable-next-line no-await-in-loop
    const resp = await safeFetch(`${DA_ADMIN}/list${path}`, { headers });
    if (!resp.ok) throw new Error(`ls ${path}: ${resp.status}`);
    // eslint-disable-next-line no-await-in-loop
    const pageItems = (await resp.json()) as DaListItem[];
    for (const item of pageItems) items.push(item);
    continuationToken = resp.headers.get('da-continuation-token');
    if (!continuationToken) break;
  }
  return items;
}

export async function cat(path: string): Promise<string> {
  const resp = await safeFetch(`${DA_ADMIN}/source${path}`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`cat ${path}: ${resp.status}`);
  return resp.text();
}

export async function readJson<T = unknown>(path: string): Promise<T | null> {
  try {
    const resp = await safeFetch(`${DA_ADMIN}/source${path}`, { headers: authHeaders() });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  const t = getToken();
  if (!t) throw new Error('DA token not set; set VITE_DA_TOKEN or run from da.live');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const body = new FormData();
  body.append('data', blob);
  const resp = await fetch(`${DA_ADMIN}/source${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}` },
    body,
  });
  if (!resp.ok) throw new Error(`write ${path}: ${resp.status}`);
}

// BFS traversal — batches ls calls to avoid overwhelming the API. Skips `drafts` folders.
export async function collectDocs(
  rootDir: string,
  onProgress?: (count: number) => void,
): Promise<string[]> {
  const docs: string[] = [];
  let dirs = [rootDir];
  while (dirs.length) {
    const nextDirs: string[] = [];
    for (let i = 0; i < dirs.length; i += LS_CONCURRENCY) {
      const batch = dirs.slice(i, i + LS_CONCURRENCY);
      // eslint-disable-next-line no-await-in-loop
      const listings = await Promise.all(batch.map((d) => ls(d).catch(() => [] as DaListItem[])));
      for (const listing of listings) {
        for (const item of listing) {
          if (item.ext === 'html') docs.push(item.path);
          else if (!item.ext && item.path.split('/').pop() !== 'drafts') nextDirs.push(item.path);
        }
      }
      if (onProgress) onProgress(docs.length);
    }
    dirs = nextDirs;
  }
  return docs;
}

export async function fetchPublishedPaths(
  paths: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  if (paths.length === 0) return [];
  const published: string[] = [];
  for (let i = 0; i < paths.length; i += STATUS_BATCH_SIZE) {
    const batchStart = Date.now();
    const batch = paths.slice(i, i + STATUS_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(batch.map(async (path) => {
      try {
        const resp = await fetch(daPathToLiveUrl(path), { method: 'HEAD' });
        return resp.ok ? path : null;
      } catch {
        return null;
      }
    }));
    for (const p of results) if (p) published.push(p);
    if (onProgress) onProgress(i + batch.length, paths.length);
    const elapsed = Date.now() - batchStart;
    const wait = STATUS_BATCH_MS - elapsed;
    // eslint-disable-next-line no-await-in-loop
    if (wait > 0 && i + STATUS_BATCH_SIZE < paths.length) await new Promise((r) => { setTimeout(r, wait); });
  }
  return published;
}
