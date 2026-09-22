import { useLayoutEffect, useRef } from 'react';
import { BlockAccordion } from './BlockAccordion';
import { sortEntries } from '../lib/scan';
import type {
  RepoConfig, MergedData, RepoBlocks, KitchenSinkBlocks, SortKey,
} from '../types';

interface Props {
  cfg: RepoConfig;
  data: MergedData;
  repoBlocks: RepoBlocks;
  publishedSet: Set<string> | null;
  kitchenSinkBlocks: KitchenSinkBlocks;
  sort: SortKey;
}

export function ResultsList({
  cfg, data, repoBlocks, publishedSet, kitchenSinkBlocks, sort,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevTops = useRef<Map<string, number>>(new Map());
  const prevSort = useRef<SortKey>(sort);

  const { own: ownBlocks, milo: miloBlocks } = repoBlocks;

  const allBlocks: Record<string, string[]> = { ...data.blocks };
  for (const name of ownBlocks) if (!allBlocks[name]) allBlocks[name] = [];
  for (const name of miloBlocks) if (!allBlocks[name]) allBlocks[name] = [];

  const sorted = sortEntries(Object.entries(allBlocks), ownBlocks, miloBlocks, sort);

  // FLIP: when the sort order changes, animate each accordion from its previous vertical position
  // to its new one. Runs after every render, but only inverts/plays when `sort` actually changed —
  // so scans and status refreshes (which re-render with the same order) don't cause spurious slides.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const els = [...container.querySelectorAll<HTMLElement>('[data-block-name]')];

    const newTops = new Map<string, number>();
    for (const el of els) newTops.set(el.dataset.blockName ?? '', el.getBoundingClientRect().top);

    if (prevSort.current !== sort) {
      for (const el of els) {
        const name = el.dataset.blockName ?? '';
        const oldTop = prevTops.current.get(name);
        if (oldTop === undefined) continue;
        const dy = oldTop - (newTops.get(name) ?? 0);
        if (dy === 0) continue;
        el.style.transition = 'none';
        el.style.transform = `translateY(${dy}px)`;
      }
      requestAnimationFrame(() => {
        for (const el of els) {
          el.style.transition = 'transform 0.35s ease';
          el.style.transform = '';
        }
        setTimeout(() => { for (const el of els) el.style.transition = ''; }, 400);
      });
    }

    prevSort.current = sort;
    prevTops.current = newTops;
  });

  return (
    <div id="results" ref={containerRef}>
      {sorted.map(([blockName, paths]) => (
        <BlockAccordion
          key={blockName}
          cfg={cfg}
          blockName={blockName}
          paths={paths}
          inOwn={ownBlocks.has(blockName)}
          inMilo={miloBlocks.has(blockName)}
          publishedSet={publishedSet}
          kitchenSinkBlocks={kitchenSinkBlocks}
        />
      ))}
    </div>
  );
}
