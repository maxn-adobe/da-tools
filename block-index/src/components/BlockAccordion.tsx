import { CopyButton } from './CopyButton';
import { KitchenSinkLink } from './KitchenSinkLink';
import { ExternalIcon } from './icons';
import { daEditUrl, publishedUrl, kitchenSinkUrl } from '../lib/urls';
import type { RepoConfig, KitchenSinkBlocks } from '../types';

interface Props {
  cfg: RepoConfig;
  blockName: string;
  paths: string[];
  inOwn: boolean;
  inMilo: boolean;
  publishedSet: Set<string> | null;
  kitchenSinkBlocks: KitchenSinkBlocks;
}

export function BlockAccordion({
  cfg, blockName, paths, inOwn, inMilo, publishedSet, kitchenSinkBlocks,
}: Props) {
  const repoType: 'own' | 'milo' | null = inOwn ? 'own' : (inMilo ? 'milo' : null);
  const className = inOwn ? 'repo-own' : (inMilo ? 'repo-milo' : undefined);

  const sortedPaths = [...paths].sort((a, b) => {
    const ap = publishedSet?.has(a) ? 0 : 1;
    const bp = publishedSet?.has(b) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.localeCompare(b);
  });

  const pubCount = publishedSet ? paths.filter((p) => publishedSet.has(p)).length : null;

  let ksHref: string | null = null;
  if (repoType) {
    const ksSet = repoType === 'own' ? kitchenSinkBlocks?.own : kitchenSinkBlocks?.milo;
    ksHref = ksSet?.has(blockName) ? kitchenSinkUrl(cfg, blockName, repoType) : null;
  }

  const copyText = () => sortedPaths
    .map((p) => (publishedSet?.has(p) ? publishedUrl(cfg, p) : daEditUrl(p)))
    .join('\n');

  return (
    <details data-block-name={blockName} className={className}>
      <summary>
        <span className="summary-left">
          <span>{blockName}</span>
          {inOwn && inMilo && <span className="override-badge">↑ milo</span>}
          <span className="summary-count">
            {` — ${paths.length} use${paths.length !== 1 ? 's' : ''}`}
            {pubCount !== null && <span className="published-count">{` (${pubCount} published)`}</span>}
          </span>
        </span>
        {repoType && <KitchenSinkLink href={ksHref} />}
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
}
