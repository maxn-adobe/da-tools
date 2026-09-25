import { useMemo, useState } from 'react';
import { Legend } from './Legend';
import { BlockDetail } from './BlockDetail';
import { sortEntries } from '../lib/scan';
import type { RepoConfig, MergedData, RepoBlocks, SortKey } from '../types';

interface Props {
  cfg: RepoConfig;
  data: MergedData;
  repoBlocks: RepoBlocks;
  publishedSet: Set<string> | null;
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
  selectedBlock: string | null;
  onSelect: (name: string) => void;
}

// Two-pane workspace: a left sidebar listing every block (with usage counts, filter, sort) and a
// main area showing the selected block's variant breakdown.
export function BlockWorkspace({
  cfg, data, repoBlocks, publishedSet, sort, onSortChange, selectedBlock, onSelect,
}: Props) {
  const { own: ownBlocks, milo: miloBlocks } = repoBlocks;
  const [filter, setFilter] = useState('');

  // Same block set as the former ResultsList: scanned blocks plus zero-use own/milo names.
  const sorted = useMemo(() => {
    const allBlocks: Record<string, string[]> = { ...data.blocks };
    for (const name of ownBlocks) if (!allBlocks[name]) allBlocks[name] = [];
    for (const name of miloBlocks) if (!allBlocks[name]) allBlocks[name] = [];
    return sortEntries(Object.entries(allBlocks), ownBlocks, miloBlocks, sort);
  }, [data.blocks, ownBlocks, miloBlocks, sort]);

  const q = filter.trim().toLowerCase();
  const visible = q ? sorted.filter(([name]) => name.includes(q)) : sorted;

  const selectedVariants = selectedBlock ? (data.variants[selectedBlock] ?? {}) : null;

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">
            <span>Blocks</span>
            <span className="sidebar-count">{sorted.length}</span>
          </div>
          <input
            className="block-filter"
            type="text"
            placeholder="Filter blocks"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="sidebar-controls">
            <Legend cfg={cfg} />
            <select
              id="sort-select"
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortKey)}
            >
              <option value="usage">By Usage</option>
              <option value="repo">By Repo</option>
              <option value="alpha">Alphabetical</option>
            </select>
          </div>
        </div>
        <ul className="block-list">
          {visible.map(([name, paths]) => {
            const cls = ownBlocks.has(name) ? 'repo-own' : (miloBlocks.has(name) ? 'repo-milo' : '');
            const isSelected = name === selectedBlock;
            return (
              <li key={name}>
                <button
                  type="button"
                  className={`block-row ${cls}${isSelected ? ' is-selected' : ''}`.trim()}
                  onClick={() => onSelect(name)}
                >
                  <span className="block-row-name">{name}</span>
                  <span className="block-row-count">{paths.length}</span>
                </button>
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="block-list-empty">{`No blocks match “${filter}”.`}</li>
          )}
        </ul>
      </aside>

      <section className="main">
        {selectedBlock && selectedVariants ? (
          <BlockDetail
            cfg={cfg}
            blockName={selectedBlock}
            variantMap={selectedVariants}
            publishedSet={publishedSet}
            inOwn={ownBlocks.has(selectedBlock)}
            inMilo={miloBlocks.has(selectedBlock)}
          />
        ) : (
          <p className="main-placeholder">Select a block to see its variants.</p>
        )}
      </section>
    </div>
  );
}
