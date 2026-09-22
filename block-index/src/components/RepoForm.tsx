import { useState } from 'react';
import { detectRepo } from '../api/github';
import type { DetectError } from '../api/github';
import { nextColor, SEED_IDS, ORG } from '../lib/config';
import type { RepoEntry } from '../types';

interface Props {
  mode: 'add' | 'edit';
  entry: RepoEntry | null;
  registry: Map<string, RepoEntry>;
  onSave: (entry: RepoEntry) => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
}

interface Msg { text: string; error?: boolean }

const DETECT_ERRORS = (rid: string): Record<DetectError, string> => ({
  'rate-limit': 'GitHub API rate limit hit — enter the blocks path manually.',
  'not-found': `github.com/${ORG}/${rid} not found — check the name.`,
  network: 'Could not reach GitHub — enter the blocks path manually.',
});

export function RepoForm({
  mode, entry, registry, onSave, onRemove, onCancel,
}: Props) {
  const [id, setId] = useState(entry?.id ?? '');
  const [label, setLabel] = useState(entry?.label ?? '');
  const [blocks, setBlocks] = useState(entry?.blocksPath ?? '');
  const [ref, setRef] = useState(entry?.ref ?? 'stage');
  const [color, setColor] = useState(entry?.color ?? nextColor(registry));
  const [usesMilo, setUsesMilo] = useState(entry ? entry.usesMilo !== false : true);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [msg, setMsg] = useState<Msg>(
    mode === 'add' ? { text: 'Enter a repo name, then Detect (or type the blocks path).' } : { text: '' },
  );
  const [detecting, setDetecting] = useState(false);
  const [removePending, setRemovePending] = useState(false);

  const isEdit = mode === 'edit';
  const canRemove = isEdit && !!entry && !SEED_IDS.has(entry.id);

  async function handleDetect() {
    const rid = id.trim().toLowerCase();
    if (!rid) { setMsg({ text: 'Enter a repo name first.', error: true }); return; }
    setMsg({ text: 'Detecting on GitHub…' });
    setDetecting(true);
    try {
      const res = await detectRepo(rid);
      if ('error' in res) {
        setMsg({ text: DETECT_ERRORS(rid)[res.error], error: true });
        return;
      }
      setRef(res.ref);
      if (!label) setLabel(rid);
      if (res.candidates.length === 1) {
        setBlocks(res.candidates[0]);
        setCandidates([]);
        setMsg({ text: `Found blocks at "${res.candidates[0]}" (branch: ${res.ref}).` });
      } else if (res.candidates.length > 1) {
        setCandidates(res.candidates);
        setBlocks(res.candidates[0]);
        setMsg({ text: 'Multiple block folders found — pick the right one.' });
      } else {
        setCandidates([]);
        setMsg({
          text: res.truncated
            ? 'Repo tree too large to auto-scan — enter the blocks path manually.'
            : 'No blocks folder detected — enter the path manually (e.g. brand/blocks).',
          error: true,
        });
      }
    } finally {
      setDetecting(false);
    }
  }

  function handleSave() {
    const rid = id.trim().toLowerCase();
    const blocksPath = blocks.trim().replace(/^\/+|\/+$/g, '');
    if (!rid) { setMsg({ text: 'Repo name is required.', error: true }); return; }
    if (!/^[a-z0-9._-]+$/.test(rid)) { setMsg({ text: 'Repo name has invalid characters.', error: true }); return; }
    if (!blocksPath) { setMsg({ text: 'Blocks path is required — use Detect or type it.', error: true }); return; }
    if (mode === 'add' && registry.has(rid)) { setMsg({ text: `"${rid}" is already in the list.`, error: true }); return; }
    onSave({
      id: rid, label: label.trim() || rid, blocksPath, ref: ref.trim() || 'stage', color, usesMilo,
    });
  }

  function handleRemove() {
    if (!entry) return;
    if (!removePending) {
      setRemovePending(true);
      setMsg({
        text: 'This only removes it from the list — its cached scan data in DA is left in place. Click "Confirm remove" to proceed.',
        error: true,
      });
      setTimeout(() => setRemovePending(false), 5000);
      return;
    }
    onRemove(entry.id);
  }

  return (
    <div id="repo-form">
      <div className="rf-title">{mode === 'add' ? 'Add a repo' : `Edit ${entry?.id}`}</div>
      <div className="rf-grid">
        <label className="rf-field">
          <span>Repo name</span>
          <span className="rf-inline">
            <input
              type="text"
              placeholder="e.g. edu"
              autoComplete="off"
              spellCheck={false}
              value={id}
              disabled={isEdit}
              onChange={(e) => setId(e.target.value)}
            />
            <button type="button" disabled={detecting} onClick={handleDetect}>Detect</button>
          </span>
        </label>
        <label className="rf-field">
          <span>Label</span>
          <input
            type="text"
            placeholder="Display name"
            autoComplete="off"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="rf-field rf-full">
          <span>Blocks path <span className="rf-hint">(within the GitHub repo)</span></span>
          <input
            type="text"
            placeholder="auto-detected, e.g. edu/blocks"
            autoComplete="off"
            spellCheck={false}
            value={blocks}
            onChange={(e) => setBlocks(e.target.value)}
          />
        </label>
        {candidates.length > 1 && (
          <div className="rf-field rf-full">
            <span>Detected block folders</span>
            <select value={blocks} onChange={(e) => setBlocks(e.target.value)}>
              {candidates.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        <label className="rf-field rf-narrow">
          <span>Branch</span>
          <input
            type="text"
            placeholder="stage"
            autoComplete="off"
            spellCheck={false}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </label>
        <label className="rf-field rf-narrow">
          <span>Accent color</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label className="rf-field rf-check">
          <input type="checkbox" checked={usesMilo} onChange={(e) => setUsesMilo(e.target.checked)} />
          <span>Uses milo blocks</span>
        </label>
      </div>
      <p className={`rf-status${msg.error ? ' error' : ''}`}>{msg.text}</p>
      <div className="rf-actions">
        <button type="button" className="rf-primary" onClick={handleSave}>Save</button>
        {canRemove && (
          <button type="button" id="rf-remove" onClick={handleRemove}>
            {removePending ? 'Confirm remove' : 'Remove'}
          </button>
        )}
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
