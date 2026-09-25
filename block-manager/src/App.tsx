import { useEffect, useMemo, useState } from 'react';
import { getToken } from './api/daApi';
import { useBlockIndex } from './hooks/useBlockIndex';
import { computeAppHref } from './lib/appLinks';
import { RepoBar } from './components/RepoBar';
import { RepoForm } from './components/RepoForm';
import { DirectoryScans } from './components/DirectoryScans';
import { BlockWorkspace } from './components/BlockWorkspace';
import type { RepoEntry } from './types';

export default function App() {
  const hasToken = useMemo(() => !!getToken(), []);
  const bi = useBlockIndex(hasToken);
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; entry: RepoEntry | null } | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);

  const back = computeAppHref('index', '../../index.html');

  const selectedEntry = bi.registry.get(bi.selectedRepoId);
  const canManageSelected = bi.canManage(selectedEntry);

  // Clear the selected block whenever the repo changes — its blocks no longer apply.
  useEffect(() => { setSelectedBlock(null); }, [bi.selectedRepoId]);

  function handleSave(entry: RepoEntry) {
    setForm(null);
    void bi.saveRepo(entry);
  }

  function handleRemove(id: string) {
    setForm(null);
    void bi.removeRepo(id);
  }

  return (
    <>
      <a className="back" href={back.href} target={back.target} data-app-path="index">All Tools</a>
      <h2>Block Manager</h2>

      {!hasToken && (
        <p className="no-token">
          No DA token — open this tool inside da.live, or set VITE_DA_TOKEN in block-manager/.env.local
          for local dev.
        </p>
      )}

      {hasToken && (
        <>
          <RepoBar
            registry={bi.registry}
            selectedRepoId={bi.selectedRepoId}
            busy={bi.busy}
            canManage={canManageSelected}
            onSelect={bi.selectRepo}
            onAdd={() => setForm({ mode: 'add', entry: null })}
            onEdit={() => setForm({ mode: 'edit', entry: selectedEntry ?? null })}
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
            dirCounts={bi.dirCounts}
            busy={bi.busy}
            open={bi.dirScansOpen}
            onToggle={bi.setDirScansOpen}
            onScanDir={bi.scanOne}
          />

          {bi.merged ? (
            <BlockWorkspace
              cfg={bi.cfg}
              data={bi.merged}
              repoBlocks={bi.repoBlocks}
              publishedSet={bi.publishedSet}
              sort={bi.sort}
              onSortChange={bi.setSort}
              selectedBlock={selectedBlock}
              onSelect={setSelectedBlock}
            />
          ) : (
            <p id="block-count" className="meta">
              No scan data yet. Expand &quot;Directory Scans&quot; above to begin.
            </p>
          )}
        </>
      )}
    </>
  );
}
