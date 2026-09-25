import { useEffect, useMemo, useRef, useState } from 'react';
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

const MIN_WIDTH = 260;
const MAX_WIDTH = 520;
const WIDTH_KEY = 'da-block-manager-sidebar-w';

function readInitialWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(n) && n > 0) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
  } catch { /* ignore */ }
  return MIN_WIDTH;
}

// Two-pane workspace: a resizable left sidebar listing every block (usage counts, filter, sort) and
// a main area showing the selected block's variant breakdown.
export function BlockWorkspace({
  cfg, data, repoBlocks, publishedSet, sort, onSortChange, selectedBlock, onSelect,
}: Props) {
  const { own: ownBlocks, milo: miloBlocks } = repoBlocks;
  const [filter, setFilter] = useState('');
  const [width, setWidth] = useState<number>(readInitialWidth);
  const asideRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  // Drag the divider to resize the sidebar between MIN_WIDTH and MAX_WIDTH.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    dragging.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX - left)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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
      <aside className="sidebar" ref={asideRef} style={{ width }}>
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
          <div className="sidebar-sort">
            <label htmlFor="sort-select">Sort by:</label>
            <select
              id="sort-select"
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortKey)}
            >
              <option value="usage">Usage</option>
              <option value="repo">Repo</option>
              <option value="alpha">Alphabetical</option>
            </select>
          </div>
          <Legend cfg={cfg} />
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

      <div
        className="sidebar-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize block list"
      />

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
