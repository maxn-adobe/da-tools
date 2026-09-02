import { useState } from 'react';
import { getToken, fetchDocument, listDirectory, urlToSourcePath } from '../api/daApi.js';
import { parseDocument } from '../utils/blockParser.js';

export default function DebugView() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);

  const [dirInput, setDirInput] = useState('');
  const [dirStatus, setDirStatus] = useState('idle');
  const [dirResult, setDirResult] = useState(null);
  const [dirError, setDirError] = useState(null);

  const token = getToken();

  async function handleListDir(e) {
    e.preventDefault();
    setDirStatus('loading');
    setDirResult(null);
    setDirError(null);
    try {
      const path = dirInput.trim();
      const result = await listDirectory(path);
      setDirResult(result);
      setDirStatus('done');
    } catch (err) {
      setDirError(err.message);
      setDirStatus('error');
    }
  }

  async function handleFetch(e) {
    e.preventDefault();
    setStatus('loading');
    setParsed(null);
    setError(null);
    try {
      const path = urlToSourcePath(input.trim());
      const html = await fetchDocument(path);
      const result = parseDocument(html);
      setParsed(result);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  return (
    <div className="debug-view">
      <div className="token-status">
        <span className={`token-dot ${token ? 'set' : 'unset'}`} />
        {token ? 'Token: SET' : 'Token: NOT SET — add VITE_DA_TOKEN to .env.local'}
      </div>

      <form onSubmit={handleFetch} className="fetch-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="/adobecom/da-express-milo/express/en/… or paste a da.live URL"
          className="path-input"
        />
        <button type="submit" disabled={!input.trim() || status === 'loading'}>
          {status === 'loading' ? 'Fetching…' : 'Fetch & Parse'}
        </button>
      </form>

      {status === 'error' && (
        <p className="error-msg">Error: {error}</p>
      )}

      {status === 'done' && parsed && (
        <div className="results">
          <p className="results-summary">
            Found <strong>{parsed.blocks.length}</strong> block{parsed.blocks.length !== 1 ? 's' : ''} in{' '}
            <strong>{parsed.sections.length}</strong> section{parsed.sections.length !== 1 ? 's' : ''}
          </p>
          {parsed.blocks.length === 0 && (
            <p className="no-blocks">No blocks found — document may contain only default content.</p>
          )}
          {parsed.blocks.map((block, i) => (
            <BlockCard key={i} block={block} />
          ))}
        </div>
      )}

      <hr className="debug-divider" />

      <div className="debug-probe">
        <p className="debug-probe-label">listDirectory() probe — paste the result back to Claude</p>
        <form onSubmit={handleListDir} className="fetch-form">
          <input
            type="text"
            value={dirInput}
            onChange={(e) => setDirInput(e.target.value)}
            placeholder="/adobecom/da-express-milo/drafts/maxn"
            className="path-input"
          />
          <button type="submit" disabled={!dirInput.trim() || dirStatus === 'loading'}>
            {dirStatus === 'loading' ? 'Loading…' : 'List Dir'}
          </button>
        </form>
        {dirStatus === 'error' && <p className="error-msg">Error: {dirError}</p>}
        {dirStatus === 'done' && dirResult !== null && (
          <pre className="dir-result">{JSON.stringify(dirResult, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function BlockCard({ block }) {
  const [expanded, setExpanded] = useState(false);
  const maxCols = block.rows.reduce((max, row) => Math.max(max, row.length), 0);

  return (
    <div className="block-card">
      <div className="block-header" onClick={() => setExpanded((x) => !x)}>
        <span className="block-name">{block.rawName}</span>
        <span className="block-meta">
          §{block.sectionIndex} · {block.rows.length} row{block.rows.length !== 1 ? 's' : ''} × {maxCols} col{maxCols !== 1 ? 's' : ''}
        </span>
        <span className="expand-toggle">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="block-rows">
          {block.rows.map((row, ri) => (
            <div key={ri} className="block-row">
              <span className="row-index">r{ri}</span>
              {row.map((cell, ci) => (
                <div key={ci} className="block-cell">
                  <span className="cell-index">c{ci}</span>
                  <div
                    className="cell-html"
                    dangerouslySetInnerHTML={{ __html: cell.html || '<em>(empty)</em>' }}
                  />
                </div>
              ))}
            </div>
          ))}
          {block.rows.length === 0 && (
            <p className="no-rows">No content rows (name-only block)</p>
          )}
        </div>
      )}
    </div>
  );
}
