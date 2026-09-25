import { CopyButton } from './CopyButton';
import { ExternalIcon } from './icons';
import { NO_VARIANT } from '../lib/scan';
import { daEditUrl, publishedUrl } from '../lib/urls';
import type { RepoConfig } from '../types';

interface Props {
  cfg: RepoConfig;
  // variant token -> doc paths (from MergedData.variants[blockName]).
  variantMap: Record<string, string[]>;
  publishedSet: Set<string> | null;
}

// The main-area detail for a selected block: its variant breakdown, each variant expandable to the
// pages that use it. Read-only. The block name / counts live in the sidebar, so this pane shows only
// a "N Variants" section title (excluding the (none) bucket from the count) + the variant rows.
export function BlockDetail({ cfg, variantMap, publishedSet }: Props) {
  // Variant rows by page count desc, then name; NO_VARIANT participates as a row but is not a variant.
  const variantEntries = Object.entries(variantMap).sort(([aName, aPaths], [bName, bPaths]) => {
    if (bPaths.length !== aPaths.length) return bPaths.length - aPaths.length;
    return aName.localeCompare(bName);
  });
  const namedCount = variantEntries.filter(([token]) => token !== NO_VARIANT).length;

  return (
    <div className="variant-detail">
      <h3 className="variant-section-title">
        {`${namedCount.toLocaleString()} Variant${namedCount === 1 ? '' : 's'}`}
      </h3>

      {variantEntries.length === 0 ? (
        <p className="main-placeholder">No instances found — scan this repo&apos;s directories.</p>
      ) : (
        <div className="variant-list">
          {variantEntries.map(([token, paths]) => {
            const sortedPaths = [...paths].sort((a, b) => {
              const ap = publishedSet?.has(a) ? 0 : 1;
              const bp = publishedSet?.has(b) ? 0 : 1;
              if (ap !== bp) return ap - bp;
              return a.localeCompare(b);
            });
            const pubCount = publishedSet ? paths.filter((p) => publishedSet.has(p)).length : null;
            const copyText = () => sortedPaths
              .map((p) => (publishedSet?.has(p) ? publishedUrl(cfg, p) : daEditUrl(p)))
              .join('\n');
            const isNone = token === NO_VARIANT;

            return (
              <details key={token} className="variant-item">
                <summary>
                  <span className="summary-left">
                    <span className={`variant-token${isNone ? ' variant-token-none' : ''}`}>{token}</span>
                    <span className="summary-count">
                      {pubCount !== null ? (
                        <>
                          {' — '}
                          <span className="pub">{pubCount.toLocaleString()}</span>
                          {` / ${paths.length.toLocaleString()} page${paths.length !== 1 ? 's' : ''}`}
                        </>
                      ) : (
                        ` — ${paths.length.toLocaleString()} page${paths.length !== 1 ? 's' : ''}`
                      )}
                    </span>
                  </span>
                  <CopyButton getText={copyText} />
                </summary>
                <ul className="block-paths">
                  {sortedPaths.map((path) => (
                    <li key={path}>
                      <a className="path-link" href={daEditUrl(path)} target="_blank" rel="noopener noreferrer">{path}</a>
                      {publishedSet?.has(path) && (
                        <a
                          className="published-badge"
                          href={publishedUrl(cfg, path)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View live page"
                        >
                          <ExternalIcon />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
