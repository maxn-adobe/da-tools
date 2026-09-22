import {
  useCallback, useEffect, useMemo, useReducer, useState,
} from 'react';
import { ls, readJson, writeJson, fetchPublishedPaths } from '../api/daApi';
import {
  AUDIT_ROOT, DEFAULT_REPO, REPO_STORAGE_KEY, SKIP_DIRS, SEED_IDS,
  deriveConfig, mergeRegistry,
} from '../lib/config';
import { loadRegistry, saveRegistry } from '../lib/registry';
import {
  fetchRepoBlocks, fetchKitchenSinkBlocks, runScanForDir, mergeAllParts, repoBlocksFromStored,
} from '../lib/scan';
import type {
  RepoEntry, RepoConfig, RepoBlocks, KitchenSinkBlocks, AuditRecord, DirPart, SortKey,
} from '../types';

const emptyRepoBlocks = (): RepoBlocks => ({ own: new Set(), milo: new Set() });

function auditPath(cfg: RepoConfig, dir: string): string {
  return `${cfg.auditDir}/audit-${dir}.json`;
}

function readInitialRepo(): string {
  try {
    const saved = localStorage.getItem(REPO_STORAGE_KEY);
    if (saved) return saved; // validated against the registry once it loads
  } catch { /* ignore */ }
  return DEFAULT_REPO;
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

  const cfg = useMemo(
    () => deriveConfig(registry.get(selectedRepoId) ?? registry.get(DEFAULT_REPO)!),
    [registry, selectedRepoId],
  );

  const merged = useMemo(() => mergeAllParts(dirParts), [dirParts]);
  const publishedSet = useMemo(
    () => (merged?.publishedPaths ? new Set(merged.publishedPaths) : null),
    [merged],
  );

  // One-time: load the shared registry, then validate the remembered repo against it.
  useEffect(() => {
    if (!hasToken) return undefined;
    let cancelled = false;
    (async () => {
      const reg = await loadRegistry();
      if (cancelled) return;
      setRegistry(reg);
      setSelectedRepoId((cur) => (reg.has(cur) ? cur : DEFAULT_REPO));
      setRegistryLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [hasToken]);

  // Per-repo init: runs on repo switch or config edit. Read-only, so StrictMode's dev double-fire
  // is merely wasteful; the cancelled guard drops stale results when the repo changes mid-flight.
  useEffect(() => {
    if (!hasToken || !registryLoaded) return undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setStatus('Loading…');
      dispatch({ type: 'RESET' });
      setDirs([]);
      setRepoBlocks(emptyRepoBlocks());
      setKsb(null);

      const [rootItems, rb, ksb] = await Promise.all([
        ls(cfg.scanRoot).catch(() => []),
        fetchRepoBlocks(cfg),
        fetchKitchenSinkBlocks(cfg),
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
        setStatus(`No content directories found under ${cfg.scanRoot} — check your read access to this repo.`);
        setBusy(false);
        return;
      }
      setDirs(dirList);

      const loaded = await Promise.all(
        dirList.map(async (dir) => [dir, await readJson<AuditRecord>(auditPath(cfg, dir))] as const),
      );
      if (cancelled) return;
      const partsObj: DirPartsState = {};
      for (const [dir, data] of loaded) partsObj[dir] = data;
      dispatch({ type: 'LOAD_ALL', parts: partsObj });

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

  const scanOne = useCallback(async (dirName: string) => {
    if (busy) return;
    setBusy(true);
    dispatch({ type: 'SET_SCANNING', dir: dirName });
    try {
      const data = await runScanForDir(cfg, dirName, repoBlocks, setStatus);
      setStatus('Saving…');
      await writeJson(auditPath(cfg, dirName), data);
      dispatch({ type: 'SET_RESULT', dir: dirName, data });
      setStatus('');
    } catch (err) {
      dispatch({ type: 'SET_RESULT', dir: dirName, data: null });
      setStatus(`Error scanning ${dirName}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, cfg, repoBlocks]);

  const scanAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setDirScansOpen(true);
    try {
      for (const dir of dirs) {
        dispatch({ type: 'SET_SCANNING', dir });
        try {
          // eslint-disable-next-line no-await-in-loop
          const data = await runScanForDir(cfg, dir, repoBlocks, setStatus);
          setStatus('Saving…');
          // eslint-disable-next-line no-await-in-loop
          await writeJson(auditPath(cfg, dir), data);
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
  }, [busy, dirs, cfg, repoBlocks]);

  const checkStatus = useCallback(async () => {
    if (busy) return;
    setBusy(true);

    const pathToDir: Record<string, string> = {};
    for (const [dir, data] of Object.entries(dirParts)) {
      if (!data || data === 'scanning') continue;
      for (const paths of Object.values(data.blocks)) {
        for (const p of paths) pathToDir[p] = dir;
      }
    }

    const allPaths = Object.keys(pathToDir);
    try {
      const publishedPaths = await fetchPublishedPaths(allPaths, (done, total) => {
        setStatus(`Checking status… ${done} / ${total}`);
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
        Object.entries(dirParts).map(async ([dir, data]) => {
          if (!data || data === 'scanning') return;
          const updated: AuditRecord = { ...data, statusCheckedAt: now, publishedPaths: publishedByDir[dir] || [] };
          updates[dir] = updated;
          await writeJson(auditPath(cfg, dir), updated);
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
    next.set(entry.id, { ...(next.get(entry.id) || {}), ...entry });
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
  }, [registry]);

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
    const nextId = next.has(selectedRepoId) ? selectedRepoId : DEFAULT_REPO;
    rememberRepo(nextId);
    setSelectedRepoId(nextId);
    setNotice(saveError
      ? `"${id}" was removed for this session, but the shared list couldn't be updated — you may lack write access to ${AUDIT_ROOT} (${saveError}).`
      : '');
  }, [registry, selectedRepoId]);

  return {
    registry,
    selectedRepoId,
    cfg,
    dirs,
    dirParts,
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
    selectRepo,
    saveRepo,
    removeRepo,
    scanOne,
    scanAll,
    checkStatus,
  };
}

export type BlockIndex = ReturnType<typeof useBlockIndex>;
