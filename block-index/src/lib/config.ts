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

// Accent colors auto-assigned to repos in order (first two match the built-in seeds).
export const COLOR_PALETTE = [
  '#fec311', '#e34850', '#2680eb', '#33ab84', '#9256d9',
  '#e68619', '#0fb5ae', '#e34bb3', '#4b6ef5', '#d83790',
];

// A repo's real block library is never under these paths — they're test fixtures, nala e2e specs,
// mocks, drafts, or milo's own libs mirror. Used to filter GitHub blocks-path auto-detection.
export const BLOCKS_EXCLUDE = /(^|\/)(nala|test|tests|drafts|mock|mocks|node_modules|libs)(\/|$)/;

// Every scannable repo is modelled as two block tiers: the site's own blocks + the milo foundation
// blocks it consumes. Nearly all adobecom EDS sites are milo-based; a repo can opt out with
// usesMilo:false, in which case only its "own" tier is fetched and shown.
export const MILO_TIER: Tier = {
  label: 'milo',
  github: 'https://api.github.com/repos/adobecom/milo/contents/libs/blocks?ref=stage',
  kitchenSink: {
    lsPath: '/adobecom/milo/docs/library/kitchen-sink',
    base: 'https://main--milo--adobecom.aem.live',
  },
};

// Built-in repos: the fallback list when repos.json is missing/unreadable, and always present in
// the picker (they can be edited but not removed). Only the fields that can't be derived from the
// repo name are stored; deriveConfig() expands each into the full config shape.
export const SEED_REPOS: RepoEntry[] = [
  {
    id: 'da-express-milo',
    label: 'Express (da-express-milo)',
    blocksPath: 'express/code/blocks',
    ref: 'stage',
    color: '#fec311',
    usesMilo: true,
  },
  {
    id: 'da-dc',
    label: 'Acrobat / DC (da-dc)',
    blocksPath: 'acrobat/blocks',
    ref: 'stage',
    color: '#e34850',
    usesMilo: true,
  },
];
export const SEED_IDS = new Set(SEED_REPOS.map((r) => r.id));

export function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Expand a minimal registry entry into the full config the rest of the tool consumes. Everything
// except blocksPath/color/usesMilo is derived from the repo id (org is always adobecom, and the
// da.live content, GitHub repo, and aem.live host all share the repo name).
export function deriveConfig(entry: RepoEntry): RepoConfig {
  const {
    id, label, blocksPath, ref = 'stage', color = COLOR_PALETTE[0], usesMilo = true,
  } = entry;
  return {
    id,
    label: label || id,
    scanRoot: `/${ORG}/${id}`,
    // Stored in the shared drafts folder above, not the repo's own drafts, so read-only repos
    // (e.g. da-dc, where not all authors can write) can still be scanned and cached here.
    auditDir: `${AUDIT_ROOT}/${id}`,
    ownColor: { text: color, bg: hexToRgba(color, 0.1), border: hexToRgba(color, 0.28) },
    own: {
      label: id,
      github: `https://api.github.com/repos/${ORG}/${id}/contents/${blocksPath}?ref=${ref}`,
      kitchenSink: {
        lsPath: `/${ORG}/${id}/docs/library/kitchen-sink`,
        base: `https://main--${id}--${ORG}.aem.live`,
      },
    },
    milo: usesMilo ? MILO_TIER : null,
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

export function nextColor(entriesById: Map<string, RepoEntry>): string {
  const used = new Set([...entriesById.values()].map((e) => (e.color || '').toLowerCase()));
  return COLOR_PALETTE.find((c) => !used.has(c)) || COLOR_PALETTE[entriesById.size % COLOR_PALETTE.length];
}
