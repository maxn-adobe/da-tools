import { useState, useEffect } from 'react';
import { listBlocks, fetchBlockJs } from '../api/githubApi.js';
import { inferSchema } from '../utils/schemaInference.js';

export default function SchemaBootstrap() {
  const [blocks, setBlocks] = useState([]);
  const [blocksStatus, setBlocksStatus] = useState('loading');
  const [blocksError, setBlocksError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [inferStatus, setInferStatus] = useState('idle');
  const [schema, setSchema] = useState(null);
  const [jsSource, setJsSource] = useState(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    listBlocks()
      .then((names) => {
        setBlocks(names);
        setBlocksStatus('done');
      })
      .catch((err) => {
        setBlocksError(err.message);
        setBlocksStatus('error');
      });
  }, []);

  async function handleBlockClick(name) {
    if (name === selectedBlock) return;
    setSelectedBlock(name);
    setInferStatus('loading');
    setSchema(null);
    setJsSource(null);
    setShowSource(false);

    try {
      const source = await fetchBlockJs(name);
      if (source === null) {
        setInferStatus('no-js');
        return;
      }
      setJsSource(source);
      setSchema(inferSchema(name, source));
      setInferStatus('done');
    } catch (err) {
      setInferStatus('error');
      setSchema({ _error: err.message });
    }
  }

  const filtered = search
    ? blocks.filter((b) => b.includes(search.toLowerCase()))
    : blocks;

  return (
    <div className="schema-bootstrap">
      <div className="schema-split">
        {/* Left: block list */}
        <div className="block-list-panel">
          <div className="block-list-header">
            <input
              className="block-search"
              type="text"
              placeholder="Filter blocks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {blocksStatus === 'done' && (
              <span className="block-count">{filtered.length} block{filtered.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {blocksStatus === 'loading' && <p className="list-status">Loading blocks…</p>}
          {blocksStatus === 'error' && (
            <p className="list-status error">Error: {blocksError}</p>
          )}
          {blocksStatus === 'done' && (
            <ul className="block-list">
              {filtered.map((name) => (
                <li
                  key={name}
                  className={`block-list-item${selectedBlock === name ? ' selected' : ''}`}
                  onClick={() => handleBlockClick(name)}
                >
                  {name}
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="block-list-empty">No matches</li>
              )}
            </ul>
          )}
        </div>

        {/* Right: schema inference result */}
        <div className="schema-panel">
          {inferStatus === 'idle' && (
            <p className="schema-empty">Select a block to infer its schema.</p>
          )}

          {inferStatus === 'loading' && (
            <p className="schema-empty">Fetching block.js…</p>
          )}

          {inferStatus === 'no-js' && (
            <p className="schema-empty">No <code>{selectedBlock}.js</code> found — CSS-only block or non-standard filename.</p>
          )}

          {inferStatus === 'error' && (
            <p className="schema-empty error">Error fetching block.js: {schema?._error}</p>
          )}

          {inferStatus === 'done' && schema && (
            <div className="schema-result">
              <div className="schema-result-header">
                <span className="schema-block-name">{schema.block}</span>
                <span className={`confidence-badge confidence-${schema._confidence}`}>
                  {schema._confidence} confidence
                </span>
              </div>

              <div className="schema-row">
                <span className="schema-label">Pattern</span>
                <span className="pattern-chip">{schema.pattern}</span>
              </div>

              <div className="schema-row">
                <span className="schema-label">Variants</span>
                <span className="schema-value">
                  {schema.variants.length > 0
                    ? schema.variants.map((v) => (
                        <span key={v} className="variant-tag">{v}</span>
                      ))
                    : <em className="schema-none">none detected</em>}
                </span>
              </div>

              {schema.cells && schema.cells.length > 0 && (
                <div className="schema-section">
                  <div className="schema-section-title">Cells</div>
                  <table className="schema-table">
                    <thead>
                      <tr>
                        <th>Index</th>
                        <th>Role</th>
                        <th>Content type</th>
                        <th>Required</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schema.cells.map((cell) => (
                        <tr key={cell.index}>
                          <td><code>{cell.index}</code></td>
                          <td><em className="schema-none">unset</em></td>
                          <td><span className={`content-type content-type-${cell.content}`}>{cell.content}</span></td>
                          <td>{cell.required ? 'yes' : 'no'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {schema.fields && schema.fields.length > 0 && (
                <div className="schema-section">
                  <div className="schema-section-title">Fields</div>
                  <table className="schema-table">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Type</th>
                        <th>Required</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schema.fields.map((field) => (
                        <tr key={field.key}>
                          <td><code>{field.key}</code></td>
                          <td>{field.type}</td>
                          <td>{field.required ? 'yes' : 'no'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {schema._notes && (
                <p className="schema-notes">{schema._notes}</p>
              )}

              <button
                className="source-toggle"
                onClick={() => setShowSource((v) => !v)}
              >
                {showSource ? 'Hide block.js source' : 'Show block.js source'}
              </button>

              {showSource && jsSource && (
                <pre className="schema-source">{jsSource}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
