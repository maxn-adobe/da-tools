import {
  useCallback, useEffect, useMemo, useReducer, useState,
} from 'react';
import { ls, collectDocs, readJson, writeJson, fetchPublishedPaths } from '../api/daApi';
import {
  AUDIT_ROOT, REPO_STORAGE_KEY, SKIP_DIRS, SEED_IDS,
  deriveConfig, mergeRegistry,
} from '../lib/config';
import { getUserEmail } from '../lib/session';
import { loadRegistry, saveRegistry } from '../lib/registry';
import {
  fetchRepoBlocks, fetchKitchenSinkBlocks, runScanForDir, mergeAllParts, repoBlocksFromStored,
} from '../lib/scan';
import type {
  RepoEntry, RepoConfig, RepoBlocks, KitchenSinkBlocks, AuditRecord, DirPart, SortKey,
} from '../types';

// How many dirs to count-crawl at once during "Count All".
const COUNT_CONCURRENCY = 3;

// No repo selected — the registry is empty until a user adds one.
const NO_REPO = '';

const emptyRepoBlocks = (): RepoBlocks => ({ own: new Set(), milo: new Set() });

function auditPath(cfg: RepoConfig, dir: string): string {
  return `${cfg.auditDir}/audit-${dir}.json`;
}

function countsPath(cfg: RepoConfig): string {
  return `${cfg.auditDir}/counts.json`;
}

interface CountsDoc { counts?: Record<string, number> }

function readInitialRepo(): string {
  try {
    const saved = localStorage.getItem(REPO_STORAGE_KEY);
    if (saved) return saved; // validated against the registry once it loads
  } catch { /* ignore */ }
  return NO_REPO;
}

function rememberRepo(id: string): void {
  try { localStorage.setItem(REPO_STORAGE_KEY, id); } catch { /* ignore */ }
}

// --- dirParts reducer: one directory changes at a time, so async scan loops can't clobber each
// other via a stale setState closure the way a plain object-in-useState would. ---
type DirPartsState = Record<string, DirPart>;
type DirPartsAction =
  | { type: 'RESET' }
  | { type: 'LOAD_ALL'; parts: DirPartsState }
  | { type: 'SET_SCANNING'; dir: string }
  | { type: 'SET_RESULT'; dir: string; data: AuditRecord | null }
  | { type: 'SET_STATUS_RESULTS'; updates: Record<string, AuditRecord> };

function dirPartsReducer(state: DirPartsState, action: DirPartsAction): DirPartsState {
  switch (action.type) {
    case 'RESET': return {};
    case 'LOAD_ALL': return { ...action.parts };
    case 'SET_SCANNING': return { ...state, [action.dir]: 'scanning' };
    case 'SET_RESULT': return { ...state, [action.dir]: action.data };
    case 'SET_STATUS_RESULTS': return { ...state, ...action.updates };
    default: return state;
  }
}

export function useBlockIndex(hasToken: boolean) {
  const [registry, setRegistry] = useState<Map<string, RepoEntry>>(() => mergeRegistry(null));
  const [registryLoaded, setRegistryLoaded] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState<string>(readInitialRepo);
  const [dirs, setDirs] = useState<string[]>([]);
  const [dirParts, dispatch] = useReducer(dirPartsReducer, {});
  const [repoBlocks, setRepoBlocks] = useState<RepoBlocks>(emptyRepoBlocks);
  const [kitchenSinkBlocks, setKsb] = useState<KitchenSinkBlocks>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState('');
  const [sort, setSort] = useState<SortKey>('usage');
  const [dirScansOpen, setDirScansOpen] = useState(false);
  // Persisted per-repo directory doc counts (like scans): a number, or 'counting' while in flight.
  const [dirCounts, setDirCounts] = useState<Record<string, number | 'counting'>>({});

  const currentEmail = getUserEmail();

  // Null when no repo is selected (empty registry / unknown remembered id).
  const cfg = useMemo<RepoConfig | null>(() => {
    const entry = registry.get(selectedRepoId);
    return entry ? deriveConfig(entry) : null;
  }, [registry, selectedRepoId]);

  const merged = useMemo(() => mergeAllParts(dirParts), [dirParts]);
  const publishedSet = useMemo(
    () => (merged?.publishedPaths ? new Set(merged.publishedPaths) : null),
    [merged],
  );

  // Persist the numeric entries of a counts map to the repo's counts.json (best-effort).
  const persistCounts = useCallback(async (
    activeCfg: RepoConfig,
    counts: Record<string, number | 'counting'>,
  ): Promise<void> => {
    const numeric: Record<string, number> = {};
    for (const [d, v] of Object.entries(counts)) if (typeof v === 'number') numeric[d] = v;
    try { await writeJson(countsPath(activeCfg), { counts: numeric }); } catch { /* ignore */ }
  }, []);

  // One-time: load the shared registry, then validate the remembered repo against it.
  useEffect(() => {
    if (!hasToken) return undefined;
    let cancelled = false;
    (async () => {
      const reg = await loadRegistry();
      if (cancelled) return;
      setRegistry(reg);
      setSelectedRepoId((cur) => (reg.has(cur) ? cur : NO_REPO));
      setRegistryLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [hasToken]);

  // Per-repo init: runs on repo switch or config edit. Read-only, so StrictMode's dev double-fire
  // is merely wasteful; the cancelled guard drops stale results when the repo changes mid-flight.
  useEffect(() => {
    if (!hasToken || !registryLoaded || !cfg) return undefined;
    const activeCfg = cfg;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setStatus('Loading…');
      dispatch({ type: 'RESET' });
      setDirs([]);
      setRepoBlocks(emptyRepoBlocks());
      setKsb(null);
      setDirCounts({});

      const [rootItems, rb, ksb] = await Promise.all([
        ls(activeCfg.scanRoot).catch(() => []),
        fetchRepoBlocks(activeCfg),
        fetchKitchenSinkBlocks(activeCfg),
      ]);
      if (cancelled) return;
      setKsb(ksb);

      let effectiveRepoBlocks = (rb.own.size > 0 || rb.milo.size > 0) ? rb : emptyRepoBlocks();

      const dirList = rootItems
        .filter((item) => !item.ext && !SKIP_DIRS.has(item.path.split('/').pop() ?? ''))
        .map((item) => item.path.split('/').pop() ?? '')
        .sort();

      if (dirList.length === 0) {
        setRepoBlocks(effectiveRepoBlocks);
        setStatus(`No content directories found under ${activeCfg.scanRoot} — check your read access to this repo.`);
        setBusy(false);
        return;
      }
      setDirs(dirList);

      const [loaded, countsDoc] = await Promise.all([
        Promise.all(
          dirList.map(async (dir) => [dir, await readJson<AuditRecord>(auditPath(activeCfg, dir))] as const),
        ),
        readJson<CountsDoc>(countsPath(activeCfg)),
      ]);
      if (cancelled) return;
      const partsObj: DirPartsState = {};
      for (const [dir, data] of loaded) partsObj[dir] = data;
      dispatch({ type: 'LOAD_ALL', parts: partsObj });

      // Load persisted directory counts (only for dirs that still exist).
      const storedCounts = countsDoc?.counts ?? {};
      const counts: Record<string, number> = {};
      for (const dir of dirList) if (typeof storedCounts[dir] === 'number') counts[dir] = storedCounts[dir];
      setDirCounts(counts);

      // Fall back to stored repo blocks if the GitHub fetch returned nothing.
      if (effectiveRepoBlocks.own.size === 0 && effectiveRepoBlocks.milo.size === 0) {
        const stored = Object.values(partsObj).find(
          (p): p is AuditRecord => !!p && p !== 'scanning' && !!(p as AuditRecord).repoBlocks,
        );
        if (stored) effectiveRepoBlocks = repoBlocksFromStored(stored.repoBlocks);
      }
      setRepoBlocks(effectiveRepoBlocks);
      setStatus('');
      setBusy(false);
    })();
    return () => { cancelled = true; };
  }, [cfg, hasToken, registryLoaded]);

  // Scan the given directories in order, persisting each as it finishes.
  const scanDirs = useCallback(async (names: string[]) => {
    if (!cfg || busy || names.length === 0) return;
    const activeCfg = cfg;
    setBusy(true);
    setDirScansOpen(true);
    try {
      for (const dir of names) {
        dispatch({ type: 'SET_SCANNING', dir });
        try {
          // eslint-disable-next-line no-await-in-loop
          const data = await runScanForDir(activeCfg, dir, repoBlocks, setStatus);
          setStatus('Saving…');
          // eslint-disable-next-line no-await-in-loop
          await writeJson(auditPath(activeCfg, dir), data);
          dispatch({ type: 'SET_RESULT', dir, data });
        } catch (err) {
          dispatch({ type: 'SET_RESULT', dir, data: null });
          setStatus(`Error scanning ${dir}: ${(err as Error).message} — continuing`);
        }
      }
      setStatus('');
    } finally {
      setBusy(false);
    }
  }, [busy, cfg, repoBlocks]);

  // Count the given directories (ls-only crawl), then persist the updated counts map once.
  const countDirs = useCallback(async (names: string[]) => {
    if (!cfg || busy || names.length === 0) return;
    const activeCfg = cfg;
    setBusy(true);
    setDirScansOpen(true);
    setDirCounts((prev) => {
      const next = { ...prev };
      for (const d of names) next[d] = 'counting';
      return next;
    });
    let done = 0;
    try {
      for (let i = 0; i < names.length; i += COUNT_CONCURRENCY) {
        const batch = names.slice(i, i + COUNT_CONCURRENCY);
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(batch.map(async (d) => {
          try {
            const docs = await collectDocs(`${activeCfg.scanRoot}/${d}`);
            setDirCounts((prev) => ({ ...prev, [d]: docs.length }));
          } catch {
            setDirCounts((prev) => { const next = { ...prev }; delete next[d]; return next; });
          } finally {
            done += 1;
            setStatus(`Counting… ${done} / ${names.length}`);
          }
        }));
      }
      // Persist the final map (read the latest via a no-op updater).
      let finalMap: Record<string, number | 'counting'> = {};
      setDirCounts((prev) => { finalMap = prev; return prev; });
      await persistCounts(activeCfg, finalMap);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }, [busy, cfg, persistCounts]);

  // Check publish status for the given directories (only those already scanned).
  const checkStatusDirs = useCallback(async (names: string[]) => {
    if (!cfg || busy || names.length === 0) return;
    const activeCfg = cfg;
    const targetDirs = names.filter((d) => {
      const data = dirParts[d];
      return !!data && data !== 'scanning';
    });
    if (targetDirs.length === 0) {
      setStatus('None of the selected directories are scanned yet — scan them first.');
      return;
    }
    setBusy(true);

    const pathToDir: Record<string, string> = {};
    for (const dir of targetDirs) {
      const data = dirParts[dir];
      if (!data || data === 'scanning') continue;
      for (const paths of Object.values(data.blocks)) {
        for (const p of paths) pathToDir[p] = dir;
      }
    }

    const allPaths = Object.keys(pathToDir);
    try {
      const publishedPaths = await fetchPublishedPaths(allPaths, (done, total) => {
        setStatus(`Checking publish status… ${done} / ${total}`);
      });

      const publishedByDir: Record<string, string[]> = {};
      for (const p of publishedPaths) {
        const dir = pathToDir[p];
        if (dir) (publishedByDir[dir] ||= []).push(p);
      }

      setStatus('Saving status results…');
      const now = new Date().toISOString();
      const updates: Record<string, AuditRecord> = {};
      await Promise.all(
        targetDirs.map(async (dir) => {
          const data = dirParts[dir];
          if (!data || data === 'scanning') return;
          const updated: AuditRecord = { ...data, statusCheckedAt: now, publishedPaths: publishedByDir[dir] || [] };
          updates[dir] = updated;
          await writeJson(auditPath(activeCfg, dir), updated);
        }),
      );
      dispatch({ type: 'SET_STATUS_RESULTS', updates });
      setStatus('');
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, dirParts, cfg]);

  const selectRepo = useCallback((id: string) => {
    if (busy) return;
    setNotice('');
    rememberRepo(id);
    setSelectedRepoId(id);
  }, [busy]);

  const saveRepo = useCallback(async (entry: RepoEntry): Promise<void> => {
    const next = new Map(registry);
    const prev = next.get(entry.id);
    // New repos are attributed to the current user (advisory); edits keep the original author.
    next.set(entry.id, { ...(prev || {}), ...entry, addedBy: prev?.addedBy ?? currentEmail ?? undefined });
    let saveError: string | null = null;
    try {
      await saveRegistry(next);
    } catch (err) {
      saveError = (err as Error).message;
    }
    setRegistry(next);
    rememberRepo(entry.id);
    setSelectedRepoId(entry.id);
    setNotice(saveError
      ? `"${entry.id}" is usable this session, but couldn't be saved to the shared list — you may lack write access to ${AUDIT_ROOT} (${saveError}).`
      : '');
  }, [registry, currentEmail]);

  const removeRepo = useCallback(async (id: string): Promise<void> => {
    if (SEED_IDS.has(id) || !registry.has(id)) return;
    const next = new Map(registry);
    next.delete(id);
    let saveError: string | null = null;
    try {
      await saveRegistry(next);
    } catch (err) {
      saveError = (err as Error).message;
    }
    setRegistry(next);
    const nextId = next.has(selectedRepoId) ? selectedRepoId : NO_REPO;
    rememberRepo(nextId);
    setSelectedRepoId(nextId);
    setNotice(saveError
      ? `"${id}" was removed for this session, but the shared list couldn't be updated — you may lack write access to ${AUDIT_ROOT} (${saveError}).`
      : '');
  }, [registry, selectedRepoId]);

  // Advisory ownership check: only the person who added a repo (by email) may edit/remove it.
  // Client-side only — not a security boundary.
  const canManage = useCallback(
    (entry: RepoEntry | undefined) => (
      !!entry && !SEED_IDS.has(entry.id) && !!entry.addedBy && entry.addedBy === currentEmail
    ),
    [currentEmail],
  );

  return {
    registry,
    registryLoaded,
    selectedRepoId,
    cfg,
    dirs,
    dirParts,
    dirCounts,
    repoBlocks,
    kitchenSinkBlocks,
    busy,
    status,
    notice,
    sort,
    setSort,
    merged,
    publishedSet,
    dirScansOpen,
    setDirScansOpen,
    currentEmail,
    canManage,
    selectRepo,
    saveRepo,
    removeRepo,
    scanDirs,
    countDirs,
    checkStatusDirs,
  };
}

export type BlockIndex = ReturnType<typeof useBlockIndex>;
