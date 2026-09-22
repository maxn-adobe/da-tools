import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { getToken } from './api/daApi';
import { useBlockIndex } from './hooks/useBlockIndex';
import { computeAppHref } from './lib/appLinks';
import { SEED_IDS } from './lib/config';
import { RepoBar } from './components/RepoBar';
import { RepoForm } from './components/RepoForm';
import { DirectoryScans } from './components/DirectoryScans';
import { ResultsSummary } from './components/ResultsSummary';
import { ResultsList } from './components/ResultsList';
import type { RepoEntry } from './types';

export default function App() {
  const hasToken = useMemo(() => !!getToken(), []);
  const bi = useBlockIndex(hasToken);
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; entry: RepoEntry | null } | null>(null);

  const back = computeAppHref('index', '../../index.html');

  // Per-repo accent, applied as CSS vars on the app root so the results/legend theme by repo.
  const ownVars = {
    '--own-color': bi.cfg.ownColor.text,
    '--own-bg': bi.cfg.ownColor.bg,
    '--own-border': bi.cfg.ownColor.border,
  } as CSSProperties;

  const blockCount = useMemo(() => {
    if (!bi.merged) return 0;
    const names = new Set(Object.keys(bi.merged.blocks));
    for (const n of bi.repoBlocks.own) names.add(n);
    for (const n of bi.repoBlocks.milo) names.add(n);
    return names.size;
  }, [bi.merged, bi.repoBlocks]);

  function handleSave(entry: RepoEntry) {
    setForm(null);
    void bi.saveRepo(entry);
  }

  function handleRemove(id: string) {
    setForm(null);
    void bi.removeRepo(id);
  }

  return (
    <div style={ownVars}>
      <a className="back" href={back.href} target={back.target} data-app-path="index">All Tools</a>
      <h2>Block Index</h2>

      {!hasToken && (
        <p className="no-token">
          No DA token — open this tool inside da.live, or set VITE_DA_TOKEN in block-index/.env.local
          for local dev.
        </p>
      )}

      {hasToken && (
        <>
          <RepoBar
            registry={bi.registry}
            selectedRepoId={bi.selectedRepoId}
            busy={bi.busy}
            isSeed={SEED_IDS.has(bi.selectedRepoId)}
            onSelect={bi.selectRepo}
            onAdd={() => setForm({ mode: 'add', entry: null })}
            onEdit={() => setForm({ mode: 'edit', entry: bi.registry.get(bi.selectedRepoId) ?? null })}
          />

          {form && (
            <RepoForm
              key={`${form.mode}:${form.entry?.id ?? 'new'}`}
              mode={form.mode}
              entry={form.entry}
              registry={bi.registry}
              onSave={handleSave}
              onRemove={handleRemove}
              onCancel={() => setForm(null)}
            />
          )}

          <div className="toolbar">
            <button type="button" onClick={bi.scanAll} disabled={bi.busy}>Scan All</button>
            {bi.merged && (
              <button type="button" onClick={bi.checkStatus} disabled={bi.busy}>
                {bi.merged.publishedPaths?.length ? 'Refresh Status' : 'Check Status'}
              </button>
            )}
          </div>

          <p id="status">{bi.status}</p>
          {bi.notice && <p className="no-token">{bi.notice}</p>}

          <DirectoryScans
            dirs={bi.dirs}
            dirParts={bi.dirParts}
            busy={bi.busy}
            open={bi.dirScansOpen}
            onToggle={bi.setDirScansOpen}
            onScanDir={bi.scanOne}
          />

          {bi.merged ? (
            <>
              <ResultsSummary
                cfg={bi.cfg}
                blockCount={blockCount}
                docCount={bi.merged.docCount}
                sort={bi.sort}
                onSortChange={bi.setSort}
              />
              <ResultsList
                cfg={bi.cfg}
                data={bi.merged}
                repoBlocks={bi.repoBlocks}
                publishedSet={bi.publishedSet}
                kitchenSinkBlocks={bi.kitchenSinkBlocks}
                sort={bi.sort}
              />
            </>
          ) : (
            <p id="block-count" className="meta">
              No scan data yet. Expand &quot;Directory Scans&quot; above to begin.
            </p>
          )}
        </>
      )}
    </div>
  );
}
