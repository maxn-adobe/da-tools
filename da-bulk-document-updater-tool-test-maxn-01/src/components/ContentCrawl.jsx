import { useState } from 'react';
import { crawlDirectory } from '../utils/daWalker.js';
import { aggregateShapes } from '../utils/shapeAggregator.js';

export default function ContentCrawl() {
  const [rootPath, setRootPath] = useState('');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ scanned: 0, current: '' });
  const [shapes, setShapes] = useState([]);
  const [error, setError] = useState(null);

  async function handleCrawl(e) {
    e.preventDefault();
    setStatus('crawling');
    setShapes([]);
    setError(null);
    setProgress({ scanned: 0, current: '' });

    try {
      const results = await crawlDirectory(rootPath.trim(), {
        onProgress: ({ scanned, current }) => setProgress({ scanned, current }),
      });
      setShapes(aggregateShapes(results));
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  return (
    <div className="content-crawl">
      <form onSubmit={handleCrawl} className="fetch-form">
        <input
          type="text"
          className="path-input"
          placeholder="/adobecom/da-express-milo/drafts/maxn"
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
        />
        <button type="submit" disabled={!rootPath.trim() || status === 'crawling'}>
          {status === 'crawling' ? 'Crawling…' : 'Crawl'}
        </button>
      </form>

      {status === 'crawling' && (
        <div className="crawl-progress">
          <span>{progress.scanned} doc{progress.scanned !== 1 ? 's' : ''} scanned</span>
          {progress.current && <span className="crawl-current">{progress.current}</span>}
        </div>
      )}

      {status === 'error' && <p className="error-msg">Error: {error}</p>}

      {status === 'done' && (
        <div className="crawl-results">
          <p className="results-summary">
            Found <strong>{shapes.length}</strong> distinct block signature{shapes.length !== 1 ? 's' : ''}
          </p>
          {shapes.length > 0 && (
            <table className="schema-table crawl-table">
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Variant</th>
                  <th>Docs</th>
                  <th>Modal shape (cells per row)</th>
                  <th>Shape variation</th>
                </tr>
              </thead>
              <tbody>
                {shapes.map((s) => (
                  <ShapeRow key={s.key} shape={s} />
                ))}
              </tbody>
            </table>
          )}
          {shapes.length === 0 && (
            <p className="no-blocks">No blocks found — documents may contain only default content.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ShapeRow({ shape }) {
  const [expanded, setExpanded] = useState(false);
  const uniqueShapes = [...new Set(shape.rowShapes.map(JSON.stringify))].map(JSON.parse);
  const hasVariation = uniqueShapes.length > 1;

  return (
    <>
      <tr
        className={`crawl-row${hasVariation ? ' has-variation' : ''}`}
        onClick={() => setExpanded((x) => !x)}
      >
        <td><code>{shape.name}</code></td>
        <td>
          {shape.variant
            ? <span className="variant-tag">{shape.variant}</span>
            : <em className="schema-none">—</em>}
        </td>
        <td>{shape.docCount}</td>
        <td><code>{JSON.stringify(shape.modalShape)}</code></td>
        <td>
          {hasVariation
            ? <span className="variation-badge">{uniqueShapes.length} shapes</span>
            : <span className="schema-none">uniform</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="crawl-row-detail">
          <td colSpan={5}>
            <div className="crawl-detail">
              <div className="crawl-detail-section">
                <strong>All observed shapes:</strong>
                <ul>
                  {uniqueShapes.map((sh, i) => {
                    const count = shape.rowShapes.filter(
                      (r) => JSON.stringify(r) === JSON.stringify(sh),
                    ).length;
                    return (
                      <li key={i}><code>{JSON.stringify(sh)}</code> — {count}×</li>
                    );
                  })}
                </ul>
              </div>
              <div className="crawl-detail-section">
                <strong>Found in:</strong>
                <ul>
                  {shape.docs.map((d) => <li key={d}><code>{d}</code></li>)}
                </ul>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
