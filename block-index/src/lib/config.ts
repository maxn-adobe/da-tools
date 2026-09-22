import type { RepoConfig, RepoEntry, Tier } from '../types';

export const BATCH_SIZE = 10;
export const SKIP_DIRS = new Set(['drafts', 'tools']);
export const REPO_STORAGE_KEY = 'da-block-index-repo';
export const DEFAULT_REPO = 'da-express-milo';
export const PUBLISHED_BASE = 'https://www.adobe.com';
export const ORG = 'adobecom';

// The scan cache and the shared repo registry both live in this da.live drafts folder: each repo
// gets a subfolder of audit-*.json, and repos.json holds the shared list of repos. Writing here
// (scanning, or adding/editing/removing repos) requires write access to this specific folder;
// merely *reading* an already-scanned repo does not.
export const AUDIT_ROOT = '/adobecom/da-express-milo/drafts/maxn/block-index-data';
export const REGISTRY_PATH = `${AUDIT_ROOT}/repos.json`;

// The GitHub branch every known repo is read from. Detect may store a different branch per repo
// (if the repo has no `stage`), but it's never shown or edited in the UI.
export const DEFAULT_REF = 'stage';

// A repo's real block library is never under these paths — they're test fixtures, nala e2e specs,
// mocks, drafts, or milo's own libs mirror. Used to filter GitHub blocks-path auto-detection.
export const BLOCKS_EXCLUDE = /(^|\/)(nala|test|tests|drafts|mock|mocks|node_modules|libs)(\/|$)/;

// Every scannable repo is modelled as two block tiers: the site's own blocks + the milo foundation
// blocks it consumes. All adobecom EDS sites here are milo-based, so milo is always shown.
export const MILO_TIER: Tier = {
  label: 'milo',
  github: 'https://api.github.com/repos/adobecom/milo/contents/libs/blocks?ref=stage',
  kitchenSink: {
    lsPath: '/adobecom/milo/docs/library/kitchen-sink',
    base: 'https://main--milo--adobecom.aem.live',
  },
};

// Built-in repos: the fallback list when repos.json is missing/unreadable, and always present in
// the picker. They have no `addedBy`, so they're locked (not editable/removable via the UI).
export const SEED_REPOS: RepoEntry[] = [
  { id: 'da-express-milo', blocksPath: 'express/code/blocks', ref: 'stage' },
  { id: 'da-dc', blocksPath: 'acrobat/blocks', ref: 'stage' },
];
export const SEED_IDS = new Set(SEED_REPOS.map((r) => r.id));

// Expand a minimal registry entry into the full config the rest of the tool consumes. The org is
// always adobecom; the label is just the repo id; the accent is uniform (amber, via CSS vars); and
// milo is always consumed. Only blocksPath (and an internal branch) vary per repo.
export function deriveConfig(entry: RepoEntry): RepoConfig {
  const { id, blocksPath, ref = DEFAULT_REF } = entry;
  return {
    id,
    label: id,
    scanRoot: `/${ORG}/${id}`,
    // Stored in the shared drafts folder above, not the repo's own drafts, so read-only repos
    // (e.g. da-dc, where not all authors can write) can still be scanned and cached here.
    auditDir: `${AUDIT_ROOT}/${id}`,
    own: {
      label: id,
      github: `https://api.github.com/repos/${ORG}/${id}/contents/${blocksPath}?ref=${ref}`,
      kitchenSink: {
        lsPath: `/${ORG}/${id}/docs/library/kitchen-sink`,
        base: `https://main--${id}--${ORG}.aem.live`,
      },
    },
    milo: MILO_TIER,
  };
}

// Seeds are the base; repos.json entries overlay them (customizing a seed) and append new repos.
// Insertion order is seeds first, then registry-only repos in file order.
export function mergeRegistry(registryRepos: RepoEntry[] | null): Map<string, RepoEntry> {
  const byId = new Map<string, RepoEntry>();
  for (const seed of SEED_REPOS) byId.set(seed.id, { ...seed });
  for (const r of registryRepos || []) {
    if (!r || !r.id) continue;
    byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
  }
  return byId;
}
