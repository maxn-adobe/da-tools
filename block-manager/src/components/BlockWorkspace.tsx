import { useEffect, useMemo, useRef, useState } from 'react';
import { Legend } from './Legend';
import { BlockDetail } from './BlockDetail';
import { CopyButton } from './CopyButton';
import { KitchenSinkLink } from './KitchenSinkLink';
import { sortEntries } from '../lib/scan';
import { daEditUrl, publishedUrl, kitchenSinkUrl } from '../lib/urls';
import type {
  RepoConfig, MergedData, RepoBlocks, KitchenSinkBlocks, SortKey,
} from '../types';

interface Props {
  cfg: RepoConfig;
  data: MergedData;
  repoBlocks: RepoBlocks;
  kitchenSinkBlocks: KitchenSinkBlocks;
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
  cfg, data, repoBlocks, kitchenSinkBlocks, publishedSet, sort, onSortChange, selectedBlock, onSelect,
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
            <span className="sidebar-count">{sorted.length.toLocaleString()}</span>
          </div>
          <div className="sidebar-subtitle">{`across ${data.docCount.toLocaleString()} documents`}</div>
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
            const total = paths.length;
            const pub = publishedSet ? paths.filter((p) => publishedSet.has(p)).length : null;

            const repoType: 'own' | 'milo' | null = ownBlocks.has(name)
              ? 'own' : (miloBlocks.has(name) ? 'milo' : null);
            let ksHref: string | null = null;
            if (repoType) {
              const ksSet = repoType === 'own' ? kitchenSinkBlocks?.own : kitchenSinkBlocks?.milo;
              ksHref = ksSet?.has(name) ? kitchenSinkUrl(cfg, name, repoType) : null;
            }
            const copyUrls = () => [...paths]
              .sort((a, b) => {
                const ap = publishedSet?.has(a) ? 0 : 1;
                const bp = publishedSet?.has(b) ? 0 : 1;
                if (ap !== bp) return ap - bp;
                return a.localeCompare(b);
              })
              .map((p) => (publishedSet?.has(p) ? publishedUrl(cfg, p) : daEditUrl(p)))
              .join('\n');

            return (
              <li key={name} className={`block-row ${cls}${isSelected ? ' is-selected' : ''}`.trim()}>
                <button type="button" className="block-row-btn" onClick={() => onSelect(name)}>
                  <span className="block-row-name">{name}</span>
                  <span className="block-row-count">
                    {pub !== null ? (
                      <>
                        <span className="pub">{pub.toLocaleString()}</span>
                        {` / ${total.toLocaleString()}`}
                      </>
                    ) : total.toLocaleString()}
                  </span>
                </button>
                <span className="block-row-icons">
                  {repoType && <KitchenSinkLink href={ksHref} />}
                  {total > 0 && <CopyButton getText={copyUrls} />}
                </span>
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
            variantMap={selectedVariants}
            publishedSet={publishedSet}
          />
        ) : (
          <p className="main-placeholder">Select a block to see its variants.</p>
        )}
      </section>
    </div>
  );
}
