import type { RepoEntry } from '../types';

interface Props {
  registry: Map<string, RepoEntry>;
  selectedRepoId: string;
  busy: boolean;
  isSeed: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: () => void;
}

export function RepoBar({
  registry, selectedRepoId, busy, isSeed, onSelect, onAdd, onEdit,
}: Props) {
  return (
    <div className="repo-bar">
      <label htmlFor="repo-select">Repo</label>
      <select
        id="repo-select"
        value={selectedRepoId}
        disabled={busy}
        onChange={(e) => onSelect(e.target.value)}
      >
        {[...registry.values()].map((entry) => (
          <option key={entry.id} value={entry.id}>{entry.label || entry.id}</option>
        ))}
      </select>
      <button className="repo-action" type="button" disabled={busy} onClick={onAdd}>+ Add repo</button>
      <button className="repo-action" type="button" disabled={busy} onClick={onEdit}>
        {isSeed ? 'Edit' : 'Edit / Remove'}
      </button>
    </div>
  );
}
