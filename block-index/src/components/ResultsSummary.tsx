import { Legend } from './Legend';
import type { RepoConfig, SortKey } from '../types';

interface Props {
  cfg: RepoConfig;
  blockCount: number;
  docCount: number;
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
}

export function ResultsSummary({
  cfg, blockCount, docCount, sort, onSortChange,
}: Props) {
  return (
    <>
      <p id="block-count" className="meta">
        {`${blockCount} unique block${blockCount !== 1 ? 's' : ''} across ${docCount.toLocaleString()} documents`}
      </p>
      <div id="legend-row">
        <Legend cfg={cfg} />
        <select id="sort-select" value={sort} onChange={(e) => onSortChange(e.target.value as SortKey)}>
          <option value="usage">By Usage</option>
          <option value="repo">By Repo</option>
          <option value="alpha">Alphabetical</option>
        </select>
      </div>
    </>
  );
}
