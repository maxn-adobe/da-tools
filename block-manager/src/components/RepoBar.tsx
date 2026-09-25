import type { RepoEntry } from '../types';

interface Props {
  registry: Map<string, RepoEntry>;
  selectedRepoId: string;
  busy: boolean;
  canManage: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: () => void;
}

export function RepoBar({
  registry, selectedRepoId, busy, canManage, onSelect, onAdd, onEdit,
}: Props) {
  const isEmpty = registry.size === 0;
  return (
    <div className="repo-bar">
      <label htmlFor="repo-select">Repo</label>
      <span className="repo-org">adobecom /</span>
      <select
        id="repo-select"
        value={selectedRepoId}
        disabled={busy || isEmpty}
        onChange={(e) => onSelect(e.target.value)}
      >
        {isEmpty && <option value="">No repos yet — add one →</option>}
        {!isEmpty && selectedRepoId === '' && <option value="" disabled>Select a repo…</option>}
        {[...registry.values()].map((entry) => (
          <option key={entry.id} value={entry.id}>{entry.id}</option>
        ))}
      </select>
      <span className="repo-bar-right">
        {canManage && (
          <button className="repo-edit" type="button" disabled={busy} onClick={onEdit}>
            Edit block path
          </button>
        )}
        <button className="repo-action" type="button" disabled={busy} onClick={onAdd}>+ Add repo</button>
      </span>
    </div>
  );
}
