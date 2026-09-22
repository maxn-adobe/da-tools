/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
/* eslint-enable import/no-unresolved */
import { ls, collectDocs, cat, readJson, writeJson, fetchPublishedPaths } from '../shared/da-api.js';
import { enhanceAppLinks } from '../shared/nav.js';

// Make the "All Tools" back-link update the outer da.live URL when embedded in da.live.
enhanceAppLinks();

const BATCH_SIZE = 10;
const SKIP_DIRS = new Set(['drafts', 'tools']);
const REPO_STORAGE_KEY = 'da-block-index-repo';
const DEFAULT_REPO = 'da-express-milo';
const PUBLISHED_BASE = 'https://www.adobe.com';
const ORG = 'adobecom';

// The scan cache and the shared repo registry both live in this da.live drafts folder: each repo
// gets a subfolder of audit-*.json, and repos.json holds the shared list of repos. Writing here
// (scanning, or adding/editing/removing repos) requires write access to this specific folder;
// merely *reading* an already-scanned repo does not.
const AUDIT_ROOT = '/adobecom/da-express-milo/drafts/maxn/block-index-data';
const REGISTRY_PATH = `${AUDIT_ROOT}/repos.json`;

// Accent colors auto-assigned to repos in order (first two match the built-in seeds).
const COLOR_PALETTE = [
  '#fec311', '#e34850', '#2680eb', '#33ab84', '#9256d9',
  '#e68619', '#0fb5ae', '#e34bb3', '#4b6ef5', '#d83790',
];

// A repo's real block library is never under these paths — they're test fixtures, nala e2e specs,
// mocks, drafts, or milo's own libs mirror. Used to filter GitHub blocks-path auto-detection.
const BLOCKS_EXCLUDE = /(^|\/)(nala|test|tests|drafts|mock|mocks|node_modules|libs)(\/|$)/;

// Every scannable repo is modelled as two block tiers: the site's own blocks + the milo foundation
// blocks it consumes. Nearly all adobecom EDS sites are milo-based; a repo can opt out with
// usesMilo:false, in which case only its "own" tier is fetched and shown.
const MILO_TIER = {
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
const SEED_REPOS = [
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
const SEED_IDS = new Set(SEED_REPOS.map((r) => r.id));

function hexToRgba(hex, alpha) {
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
function deriveConfig(entry) {
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
function mergeRegistry(registryRepos) {
  const byId = new Map();
  for (const seed of SEED_REPOS) byId.set(seed.id, { ...seed });
  for (const r of registryRepos || []) {
    if (!r || !r.id) continue;
    byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
  }
  return byId;
}

async function loadRegistry(token) {
  const doc = await readJson(REGISTRY_PATH, token);
  const repos = doc && Array.isArray(doc.repos) ? doc.repos : null;
  return mergeRegistry(repos);
}

async function saveRegistry(entriesById, token) {
  await writeJson(REGISTRY_PATH, { version: 1, repos: [...entriesById.values()] }, token);
}

function nextColor(entriesById) {
  const used = new Set([...entriesById.values()].map((e) => (e.color || '').toLowerCase()));
  return COLOR_PALETTE.find((c) => !used.has(c)) || COLOR_PALETTE[entriesById.size % COLOR_PALETTE.length];
}

// --- GitHub repo / blocks-path auto-detection (runs only when adding a repo) ---
async function fetchRepoMeta(id) {
  try {
    const resp = await fetch(`https://api.github.com/repos/${ORG}/${id}`);
    if (resp.status === 403) return { error: 'rate-limit' };
    if (!resp.ok) return { error: 'not-found' };
    return { meta: await resp.json() };
  } catch { return { error: 'network' }; }
}

async function fetchTree(id, ref) {
  try {
    const resp = await fetch(`https://api.github.com/repos/${ORG}/${id}/git/trees/${ref}?recursive=1`);
    if (!resp.ok) return null;
    return resp.json();
  } catch { return null; }
}

// Resolve { ref, candidates:[blocksPath...], truncated } for a repo, or { error }. Prefers the
// stage branch (what the tool reads by default), falling back to the repo's default branch.
async function detectRepo(id) {
  const { meta, error } = await fetchRepoMeta(id);
  if (error) return { error };
  const refs = ['stage', meta.default_branch].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const ref of refs) {
    // eslint-disable-next-line no-await-in-loop
    const tree = await fetchTree(id, ref);
    if (!tree || !tree.tree) continue;
    const candidates = tree.tree
      .filter((t) => t.type === 'tree' && t.path.endsWith('/blocks') && !BLOCKS_EXCLUDE.test(t.path))
      .map((t) => t.path);
    return { ref, candidates, truncated: !!tree.truncated };
  }
  return { ref: refs[0] || 'main', candidates: [], truncated: false };
}

const $repoSelect = document.getElementById('repo-select');
const $addRepoBtn = document.getElementById('add-repo-btn');
const $editRepoBtn = document.getElementById('edit-repo-btn');
const $scanAllBtn = document.getElementById('scan-all-btn');
const $statusBtn = document.getElementById('status-btn');
const $status = document.getElementById('status');
const $blockCount = document.getElementById('block-count');
const $legend = document.getElementById('legend');
const $results = document.getElementById('results');
const $dirDetails = document.getElementById('dir-details');
const $dirList = document.getElementById('dir-list');
const $sortSelect = document.getElementById('sort-select');

// Add/edit repo form
const $repoForm = document.getElementById('repo-form');
const $rfTitle = document.getElementById('rf-title');
const $rfId = document.getElementById('rf-id');
const $rfDetect = document.getElementById('rf-detect');
const $rfLabel = document.getElementById('rf-label');
const $rfBlocks = document.getElementById('rf-blocks');
const $rfCandidatesField = document.getElementById('rf-candidates-field');
const $rfCandidates = document.getElementById('rf-blocks-candidates');
const $rfRef = document.getElementById('rf-ref');
const $rfColor = document.getElementById('rf-color');
const $rfMilo = document.getElementById('rf-milo');
const $rfStatus = document.getElementById('rf-status');
const $rfSave = document.getElementById('rf-save');
const $rfRemove = document.getElementById('rf-remove');
const $rfCancel = document.getElementById('rf-cancel');

async function fetchGitHubDirNames(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const items = await resp.json();
    return items.filter((i) => i.type === 'dir').map((i) => i.name.toLowerCase());
  } catch {
    return [];
  }
}

async function fetchRepoBlocks(cfg) {
  const [ownNames, miloNames] = await Promise.all([
    fetchGitHubDirNames(cfg.own.github),
    cfg.milo ? fetchGitHubDirNames(cfg.milo.github) : Promise.resolve([]),
  ]);
  return { own: new Set(ownNames), milo: new Set(miloNames) };
}

function extractBlocks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = new Set();

  for (const div of doc.querySelectorAll('main > div > div[class]')) {
    const firstClass = div.className.trim().toLowerCase().split(/\s+/)[0];
    if (firstClass) blocks.add(firstClass);
  }

  for (const table of doc.querySelectorAll('main > div > table')) {
    const firstCell = table.querySelector('tr:first-child th, tr:first-child td');
    if (firstCell) {
      const text = firstCell.textContent.trim().toLowerCase().split(/[\s(,]/)[0];
      if (text) blocks.add(text);
    }
  }

  return [...blocks];
}

function repoBlocksFromStored(stored) {
  // Accept both the current { own, milo } shape and the legacy { express, milo } / array shapes.
  if (Array.isArray(stored)) return { own: new Set(stored), milo: new Set() };
  return {
    own: new Set(stored.own || stored.express || []),
    milo: new Set(stored.milo || []),
  };
}

function mergeAllParts(dirParts) {
  const parts = Object.values(dirParts).filter((d) => d && d !== 'scanning');
  if (parts.length === 0) return null;

  const blocks = {};
  let docCount = 0;
  let scanErrors = 0;

  for (const part of parts) {
    docCount += part.docCount;
    scanErrors += (part.scanErrors || 0);
    for (const [block, paths] of Object.entries(part.blocks)) {
      if (!blocks[block]) blocks[block] = [];
      blocks[block].push(...paths);
    }
  }

  const publishedPaths = parts.flatMap((p) => p.publishedPaths || []);

  return {
    blocks,
    docCount,
    scanErrors,
    publishedPaths: publishedPaths.length ? publishedPaths : null,
  };
}

function sortEntries(entries, ownBlocks, miloBlocks) {
  if ($sortSelect.value === 'alpha') {
    return entries.sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
  }
  if ($sortSelect.value === 'repo') {
    const rank = (name) => {
      if (ownBlocks.has(name)) return 0;
      if (miloBlocks.has(name)) return 1;
      return 2;
    };
    return entries.sort(([nameA, a], [nameB, b]) => {
      const dr = rank(nameA) - rank(nameB);
      if (dr !== 0) return dr;
      if (b.length !== a.length) return b.length - a.length;
      return nameA.localeCompare(nameB);
    });
  }
  return entries.sort(([nameA, a], [nameB, b]) => {
    if (b.length !== a.length) return b.length - a.length;
    return nameA.localeCompare(nameB);
  });
}

function applyFlipAnimation(container, renderFn) {
  const items = [...container.children];
  const oldTops = new Map(items.map((el) => [el.dataset.blockName, el.getBoundingClientRect().top]));

  renderFn();

  const newItems = [...container.children];
  for (const el of newItems) {
    const oldTop = oldTops.get(el.dataset.blockName);
    if (oldTop === undefined) continue;
    const dy = oldTop - el.getBoundingClientRect().top;
    if (dy === 0) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
  }

  requestAnimationFrame(() => {
    for (const el of newItems) {
      el.style.transition = 'transform 0.35s ease';
      el.style.transform = '';
    }
    setTimeout(() => {
      for (const el of newItems) {
        el.style.transition = '';
      }
    }, 400);
  });
}

const COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const BOOK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

function daEditUrl(path) {
  return `https://da.live/edit#${path.replace(/\.html$/, '')}`;
}

function publishedUrl(cfg, path) {
  const withoutPrefix = path.replace(cfg.scanRoot, '');
  const withoutExt = withoutPrefix.replace(/\.html$/, '');
  return `${PUBLISHED_BASE}${withoutExt}`;
}

async function fetchKitchenSinkBlocks(cfg, token) {
  const toSet = (items) => new Set(
    items.filter((i) => i.ext === 'html').map((i) => i.path.split('/').pop().replace(/\.html$/, '')),
  );
  const [ownList, miloList] = await Promise.all([
    ls(cfg.own.kitchenSink.lsPath, token).catch(() => []),
    cfg.milo ? ls(cfg.milo.kitchenSink.lsPath, token).catch(() => []) : Promise.resolve([]),
  ]);
  return { own: toSet(ownList), milo: toSet(miloList) };
}

function kitchenSinkUrl(cfg, blockName, tier) {
  const base = tier === 'milo' ? cfg.milo.kitchenSink.base : cfg.own.kitchenSink.base;
  return `${base}/docs/library/kitchen-sink/${blockName}`;
}

function renderResults(cfg, data, repoBlocks, publishedSet, kitchenSinkBlocks) {
  const { own: ownBlocks, milo: miloBlocks } = repoBlocks;
  const allRepoBlocks = new Set([...ownBlocks, ...miloBlocks]);

  const allBlocks = { ...data.blocks };
  for (const name of allRepoBlocks) {
    if (!allBlocks[name]) allBlocks[name] = [];
  }

  const sorted = sortEntries(Object.entries(allBlocks), ownBlocks, miloBlocks);

  $blockCount.textContent = `${sorted.length} unique block${sorted.length !== 1 ? 's' : ''} across ${data.docCount.toLocaleString()} documents`;

  $legend.innerHTML = `
    <span class="legend-own"><span class="legend-express-square">■</span> ${cfg.own.label}</span>
    ${cfg.milo ? `<span class="legend-milo"><span class="legend-express-square">■</span> ${cfg.milo.label}</span>` : ''}
    <span class="legend-unknown"><span class="legend-express-square">■</span> unrecognized</span>
  `;

  $results.innerHTML = '';

  for (const [blockName, paths] of sorted) {
    const inOwn = ownBlocks.has(blockName);
    const inMilo = miloBlocks.has(blockName);

    const details = document.createElement('details');
    details.dataset.blockName = blockName;
    if (inOwn) details.className = 'repo-own';
    else if (inMilo) details.className = 'repo-milo';

    const summary = document.createElement('summary');
    const left = document.createElement('span');
    left.className = 'summary-left';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = blockName;
    left.appendChild(nameSpan);

    if (inOwn && inMilo) {
      const badge = document.createElement('span');
      badge.className = 'override-badge';
      badge.textContent = '↑ milo';
      left.appendChild(badge);
    }

    const countSpan = document.createElement('span');
    countSpan.className = 'summary-count';
    const pubCount = publishedSet ? paths.filter((p) => publishedSet.has(p)).length : null;
    const pubSuffix = pubCount !== null ? ` <span class="published-count">(${pubCount} published)</span>` : '';
    countSpan.innerHTML = ` — ${paths.length} use${paths.length !== 1 ? 's' : ''}${pubSuffix}`;
    left.appendChild(countSpan);

    summary.appendChild(left);

    const ul = document.createElement('ul');
    ul.className = 'block-paths';
    const sortedPaths = [...paths].sort((a, b) => {
      const ap = publishedSet?.has(a) ? 0 : 1;
      const bp = publishedSet?.has(b) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.localeCompare(b);
    });

    // eslint-disable-next-line no-nested-ternary
    const repoType = inOwn ? 'own' : inMilo ? 'milo' : null;
    if (repoType) {
      const ksSet = repoType === 'own' ? kitchenSinkBlocks?.own : kitchenSinkBlocks?.milo;
      const hasKS = ksSet?.has(blockName) ?? false;
      const ksEl = document.createElement(hasKS ? 'a' : 'span');
      ksEl.className = hasKS ? 'ks-btn' : 'ks-btn disabled';
      ksEl.innerHTML = BOOK_ICON;
      ksEl.title = hasKS ? 'View kitchen-sink docs' : 'No kitchen-sink page';
      if (hasKS) {
        ksEl.href = kitchenSinkUrl(cfg, blockName, repoType);
        ksEl.target = '_blank';
        ksEl.rel = 'noopener noreferrer';
        ksEl.addEventListener('click', (e) => e.stopPropagation());
      }
      summary.appendChild(ksEl);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-btn';
    copyBtn.title = 'Copy all paths';
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = sortedPaths.map((p) => (publishedSet?.has(p) ? publishedUrl(cfg, p) : daEditUrl(p))).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = CHECK_ICON;
        copyBtn.style.color = '#2d9e2d';
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON;
          copyBtn.style.color = '';
        }, 1500);
      });
    });
    summary.appendChild(copyBtn);

    for (const path of sortedPaths) {
      const li = document.createElement('li');
      const pathLink = document.createElement('a');
      pathLink.className = 'path-link';
      pathLink.href = daEditUrl(path);
      pathLink.target = '_blank';
      pathLink.rel = 'noopener noreferrer';
      pathLink.textContent = path;
      li.appendChild(pathLink);
      if (publishedSet && publishedSet.has(path)) {
        const badge = document.createElement('a');
        badge.className = 'published-badge';
        badge.href = publishedUrl(cfg, path);
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.title = 'View live page';
        badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
        li.appendChild(badge);
      }
      ul.appendChild(li);
    }
    details.appendChild(summary);
    details.appendChild(ul);
    $results.appendChild(details);
  }
}

// Resolve the DA auth token. When embedded in da.live the injected SDK provides it; for standalone
// local dev, set localStorage['da-dev-token'] (or pass ?daToken=… once to persist it) — this mirrors
// the Vite tools' VITE_DA_TOKEN. The SDK await is raced with a timeout so standalone use never hangs.
async function resolveToken() {
  try {
    const param = new URL(location.href).searchParams.get('daToken');
    if (param) localStorage.setItem('da-dev-token', param);
  } catch { /* ignore */ }
  let devToken = null;
  try { devToken = localStorage.getItem('da-dev-token'); } catch { /* ignore */ }
  if (devToken) return devToken;
  try {
    const sdk = await Promise.race([
      DA_SDK,
      new Promise((_, reject) => { setTimeout(() => reject(new Error('SDK timeout')), 4000); }),
    ]);
    return sdk.token;
  } catch { return null; }
}

(async function main() {
  const token = await resolveToken();
  if (!token) {
    $status.textContent = 'No DA token — open this tool inside da.live, or set localStorage["da-dev-token"] to a DA token for local dev.';
    return;
  }

  // --- Shared repo registry (id -> minimal entry); starts with seeds until loaded ---
  let entriesById = mergeRegistry(null);

  // --- Per-repo state (reset by initRepo on every repo switch) ---
  let cfg = deriveConfig(entriesById.get(DEFAULT_REPO));
  let dirs = [];
  let dirParts = {};
  let repoBlocks = { own: new Set(), milo: new Set() };
  let kitchenSinkBlocks = null;
  let isBusy = false;
  let lastRenderData = null;
  let lastPublishedSet = null;

  function setStatus(text) { $status.textContent = text; }

  function setBusy(busy) {
    isBusy = busy;
    $scanAllBtn.disabled = busy;
    $repoSelect.disabled = busy;
    $addRepoBtn.disabled = busy;
    $editRepoBtn.disabled = busy;
    if ($statusBtn.style.display !== 'none') $statusBtn.disabled = busy;
  }

  function auditPath(dirname) {
    return `${cfg.auditDir}/audit-${dirname}.json`;
  }

  function renderDirList() {
    $dirList.innerHTML = '';
    for (const dir of dirs) {
      const data = dirParts[dir];
      const isScanning = data === 'scanning';

      const row = document.createElement('div');
      row.className = 'dir-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'dir-name';
      nameEl.textContent = dir;

      const metaEl = document.createElement('span');
      metaEl.className = 'dir-meta';
      if (isScanning) {
        metaEl.textContent = 'scanning…';
      } else if (data) {
        metaEl.textContent = `${data.docCount.toLocaleString()} docs · ${new Date(data.scannedAt).toLocaleDateString()}`;
      } else {
        metaEl.textContent = 'never scanned';
        metaEl.classList.add('dim');
      }

      const btn = document.createElement('button');
      btn.className = 'dir-btn';
      btn.textContent = isScanning ? '…' : (data ? 'Rescan' : 'Scan');
      btn.disabled = isBusy;
      if (!isBusy) btn.addEventListener('click', () => scanOneDir(dir));

      row.appendChild(nameEl);
      row.appendChild(metaEl);
      row.appendChild(btn);
      $dirList.appendChild(row);
    }
  }

  function renderMergedResults() {
    const merged = mergeAllParts(dirParts);
    if (!merged) {
      $blockCount.textContent = 'No scan data yet. Expand "Directory Scans" above to begin.';
      $legend.innerHTML = '';
      $results.innerHTML = '';
      $statusBtn.style.display = 'none';
      lastRenderData = null;
      lastPublishedSet = null;
      return;
    }
    lastRenderData = merged;
    lastPublishedSet = merged.publishedPaths ? new Set(merged.publishedPaths) : null;
    renderResults(cfg, merged, repoBlocks, lastPublishedSet, kitchenSinkBlocks);
    $statusBtn.style.display = '';
    $statusBtn.textContent = merged.publishedPaths?.length ? 'Refresh Status' : 'Check Status';
  }

  async function runScanForDir(dirName) {
    const dirPath = `${cfg.scanRoot}/${dirName}`;
    const blocks = {};
    let scanned = 0;
    let errors = 0;

    const docs = await collectDocs(dirPath, token, (count) => {
      setStatus(`Scanning ${dirName}… ${count} documents found`);
    });

    setStatus(`Scanning ${dirName}… 0 / ${docs.length}`);

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line no-await-in-loop
      const batchErrors = await Promise.all(batch.map(async (path) => {
        try {
          const html = await cat(path, token);
          for (const name of extractBlocks(html)) {
            if (!blocks[name]) blocks[name] = [];
            blocks[name].push(path);
          }
          return 0;
        } catch { return 1; }
      }));
      errors += batchErrors.reduce((s, e) => s + e, 0);
      scanned += batch.length;
      const errStr = errors > 0 ? `, ${errors} error${errors !== 1 ? 's' : ''}` : '';
      setStatus(`Scanning ${dirName}… ${scanned} / ${docs.length}${errStr}`);
    }

    return {
      scannedAt: new Date().toISOString(),
      docCount: docs.length,
      scanErrors: errors,
      repoBlocks: { own: [...repoBlocks.own], milo: [...repoBlocks.milo] },
      blocks,
    };
  }

  async function scanOneDir(dirName) {
    if (isBusy) return;
    setBusy(true);
    dirParts[dirName] = 'scanning';
    renderDirList();

    try {
      const data = await runScanForDir(dirName);
      setStatus('Saving…');
      await writeJson(auditPath(dirName), data, token);
      dirParts[dirName] = data;
      setStatus('');
    } catch (err) {
      dirParts[dirName] = null;
      setStatus(`Error scanning ${dirName}: ${err.message}`);
    } finally {
      setBusy(false);
      renderDirList();
      renderMergedResults();
    }
  }

  async function scanAllDirs() {
    if (isBusy) return;
    setBusy(true);
    $dirDetails.open = true;

    try {
      for (const dir of dirs) {
        dirParts[dir] = 'scanning';
        renderDirList();
        try {
          // eslint-disable-next-line no-await-in-loop
          const data = await runScanForDir(dir);
          setStatus('Saving…');
          // eslint-disable-next-line no-await-in-loop
          await writeJson(auditPath(dir), data, token);
          dirParts[dir] = data;
          renderDirList();
          renderMergedResults();
        } catch (err) {
          dirParts[dir] = null;
          setStatus(`Error scanning ${dir}: ${err.message} — continuing`);
          renderDirList();
        }
      }
      setStatus('');
    } finally {
      setBusy(false);
      renderDirList();
    }
  }

  async function checkStatus() {
    if (isBusy) return;
    setBusy(true);

    const pathToDir = {};
    for (const [dir, data] of Object.entries(dirParts)) {
      if (!data || data === 'scanning') continue;
      for (const paths of Object.values(data.blocks)) {
        for (const p of paths) pathToDir[p] = dir;
      }
    }

    const allPaths = Object.keys(pathToDir);
    try {
      const publishedPaths = await fetchPublishedPaths(allPaths, token, (done, total) => {
        setStatus(`Checking status… ${done} / ${total}`);
      });

      const publishedByDir = {};
      for (const p of publishedPaths) {
        const dir = pathToDir[p];
        if (dir) {
          if (!publishedByDir[dir]) publishedByDir[dir] = [];
          publishedByDir[dir].push(p);
        }
      }

      setStatus('Saving status results…');
      const now = new Date().toISOString();
      await Promise.all(
        dirs.map(async (dir) => {
          const data = dirParts[dir];
          if (!data || data === 'scanning') return;
          const updated = { ...data, statusCheckedAt: now, publishedPaths: publishedByDir[dir] || [] };
          dirParts[dir] = updated;
          await writeJson(auditPath(dir), updated, token);
        }),
      );

      setStatus('');
      renderMergedResults();
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function initRepo(repoId) {
    const entry = entriesById.get(repoId) || entriesById.get(DEFAULT_REPO);
    cfg = deriveConfig(entry);
    $editRepoBtn.textContent = SEED_IDS.has(cfg.id) ? 'Edit' : 'Edit / Remove';

    // Reset per-repo state and UI.
    dirs = [];
    dirParts = {};
    repoBlocks = { own: new Set(), milo: new Set() };
    kitchenSinkBlocks = null;
    lastRenderData = null;
    lastPublishedSet = null;

    document.documentElement.style.setProperty('--own-color', cfg.ownColor.text);
    document.documentElement.style.setProperty('--own-bg', cfg.ownColor.bg);
    document.documentElement.style.setProperty('--own-border', cfg.ownColor.border);

    $blockCount.textContent = '';
    $legend.innerHTML = '';
    $results.innerHTML = '';
    $dirList.innerHTML = '';
    $statusBtn.style.display = 'none';

    setBusy(true);
    setStatus('Loading…');

    const [rootItems, rb, ksb] = await Promise.all([
      ls(cfg.scanRoot, token).catch(() => []),
      fetchRepoBlocks(cfg),
      fetchKitchenSinkBlocks(cfg, token),
    ]);
    kitchenSinkBlocks = ksb;

    // Fall back to stored repo blocks (below) if the GitHub fetch returned nothing.
    repoBlocks = (rb.own.size > 0 || rb.milo.size > 0) ? rb : { own: new Set(), milo: new Set() };

    dirs = rootItems
      .filter((item) => !item.ext && !SKIP_DIRS.has(item.path.split('/').pop()))
      .map((item) => item.path.split('/').pop())
      .sort();

    if (dirs.length === 0) {
      setStatus(`No content directories found under ${cfg.scanRoot} — check your read access to this repo.`);
      setBusy(false);
      return;
    }

    // Load each dir's cached scan (missing files → null → "never scanned").
    await Promise.all(
      dirs.map(async (dir) => {
        dirParts[dir] = await readJson(auditPath(dir), token);
      }),
    );

    // Update repoBlocks fallback now that dirParts is populated.
    if (repoBlocks.own.size === 0 && repoBlocks.milo.size === 0) {
      const stored = Object.values(dirParts).find((p) => p && p.repoBlocks);
      if (stored) repoBlocks = repoBlocksFromStored(stored.repoBlocks);
    }

    setStatus('');
    setBusy(false);
    renderDirList();
    renderMergedResults();
  }

  function rememberRepo(id) {
    try { localStorage.setItem(REPO_STORAGE_KEY, id); } catch { /* ignore */ }
  }

  function rebuildRepoSelect(selectedId) {
    $repoSelect.innerHTML = '';
    for (const entry of entriesById.values()) {
      const opt = document.createElement('option');
      opt.value = entry.id;
      opt.textContent = entry.label || entry.id;
      $repoSelect.appendChild(opt);
    }
    if (selectedId) $repoSelect.value = selectedId;
  }

  // --- Add / edit / remove repo form ---
  let formMode = null; // 'add' | 'edit'
  let removePending = false;

  function setRfStatus(text, isError) {
    $rfStatus.textContent = text || '';
    $rfStatus.classList.toggle('error', !!isError);
  }

  function resetRemoveBtn() {
    removePending = false;
    $rfRemove.textContent = 'Remove';
  }

  function showCandidates(candidates) {
    if (candidates && candidates.length > 1) {
      $rfCandidates.innerHTML = '';
      for (const c of candidates) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        $rfCandidates.appendChild(opt);
      }
      [$rfBlocks.value] = candidates;
      $rfCandidatesField.hidden = false;
    } else {
      $rfCandidatesField.hidden = true;
    }
  }

  function openForm(mode, entry) {
    if (mode === 'edit' && !entry) return;
    formMode = mode;
    resetRemoveBtn();
    $rfTitle.textContent = mode === 'add' ? 'Add a repo' : `Edit ${entry.id}`;
    $rfId.value = entry ? entry.id : '';
    $rfId.disabled = mode === 'edit';
    $rfLabel.value = (entry && entry.label) || '';
    $rfBlocks.value = (entry && entry.blocksPath) || '';
    $rfRef.value = (entry && entry.ref) || 'stage';
    $rfColor.value = (entry && entry.color) || nextColor(entriesById);
    $rfMilo.checked = entry ? entry.usesMilo !== false : true;
    $rfRemove.hidden = !(mode === 'edit' && entry && !SEED_IDS.has(entry.id));
    showCandidates(null);
    setRfStatus(mode === 'add' ? 'Enter a repo name, then Detect (or type the blocks path).' : '');
    $repoForm.hidden = false;
    $rfId.focus();
  }

  function closeForm() {
    $repoForm.hidden = true;
    formMode = null;
    resetRemoveBtn();
  }

  async function runDetect() {
    const id = $rfId.value.trim().toLowerCase();
    if (!id) { setRfStatus('Enter a repo name first.', true); return; }
    setRfStatus('Detecting on GitHub…');
    $rfDetect.disabled = true;
    try {
      const res = await detectRepo(id);
      if (res.error === 'rate-limit') {
        setRfStatus('GitHub API rate limit hit — enter the blocks path manually.', true); return;
      }
      if (res.error === 'not-found') {
        setRfStatus(`github.com/${ORG}/${id} not found — check the name.`, true); return;
      }
      if (res.error) {
        setRfStatus('Could not reach GitHub — enter the blocks path manually.', true); return;
      }
      $rfRef.value = res.ref;
      if (!$rfLabel.value) $rfLabel.value = id;
      if (res.candidates.length === 1) {
        [$rfBlocks.value] = res.candidates;
        showCandidates(null);
        setRfStatus(`Found blocks at "${res.candidates[0]}" (branch: ${res.ref}).`);
      } else if (res.candidates.length > 1) {
        showCandidates(res.candidates);
        setRfStatus('Multiple block folders found — pick the right one.');
      } else {
        showCandidates(null);
        setRfStatus(res.truncated
          ? 'Repo tree too large to auto-scan — enter the blocks path manually.'
          : 'No blocks folder detected — enter the path manually (e.g. brand/blocks).', true);
      }
    } finally {
      $rfDetect.disabled = false;
    }
  }

  async function saveForm() {
    const id = $rfId.value.trim().toLowerCase();
    const blocksPath = $rfBlocks.value.trim().replace(/^\/+|\/+$/g, '');
    if (!id) { setRfStatus('Repo name is required.', true); return; }
    if (!/^[a-z0-9._-]+$/.test(id)) { setRfStatus('Repo name has invalid characters.', true); return; }
    if (!blocksPath) { setRfStatus('Blocks path is required — use Detect or type it.', true); return; }
    if (formMode === 'add' && entriesById.has(id)) { setRfStatus(`"${id}" is already in the list.`, true); return; }

    const entry = {
      ...(entriesById.get(id) || {}),
      id,
      label: $rfLabel.value.trim() || id,
      blocksPath,
      ref: $rfRef.value.trim() || 'stage',
      color: $rfColor.value,
      usesMilo: $rfMilo.checked,
    };
    entriesById.set(id, entry);

    setRfStatus('Saving…');
    $rfSave.disabled = true;
    let saveError = null;
    try {
      await saveRegistry(entriesById, token);
    } catch (err) {
      saveError = err.message;
    } finally {
      $rfSave.disabled = false;
    }
    closeForm();
    rebuildRepoSelect(id);
    rememberRepo(id);
    await initRepo(id);
    // initRepo resets the status line, so surface any persistence failure afterwards.
    if (saveError) {
      setStatus(`"${id}" is usable this session, but couldn't be saved to the shared list — you may lack write access to ${AUDIT_ROOT} (${saveError}).`);
    }
  }

  async function removeCurrentRepo() {
    const id = $rfId.value.trim().toLowerCase();
    if (!id || SEED_IDS.has(id) || !entriesById.has(id)) return;
    if (!removePending) {
      removePending = true;
      $rfRemove.textContent = 'Confirm remove';
      setRfStatus('This only removes it from the list — its cached scan data in DA is left in place. Click "Confirm remove" to proceed.', true);
      setTimeout(resetRemoveBtn, 5000);
      return;
    }
    resetRemoveBtn();
    entriesById.delete(id);
    setRfStatus('Saving…');
    let saveError = null;
    try {
      await saveRegistry(entriesById, token);
    } catch (err) {
      saveError = err.message;
    }
    closeForm();
    const nextId = entriesById.has(cfg.id) ? cfg.id : DEFAULT_REPO;
    rebuildRepoSelect(nextId);
    rememberRepo(nextId);
    await initRepo(nextId);
    if (saveError) {
      setStatus(`"${id}" was removed for this session, but the shared list couldn't be updated — you may lack write access to ${AUDIT_ROOT} (${saveError}).`);
    }
  }

  // --- Wire up controls once; they read the current repo's closure state. ---
  $scanAllBtn.addEventListener('click', scanAllDirs);
  $statusBtn.addEventListener('click', checkStatus);

  $sortSelect.addEventListener('change', () => {
    if (!lastRenderData) return;
    applyFlipAnimation($results, () => {
      renderResults(cfg, lastRenderData, repoBlocks, lastPublishedSet, kitchenSinkBlocks);
    });
  });

  $repoSelect.addEventListener('change', () => {
    if (isBusy) { $repoSelect.value = cfg.id; return; }
    const id = $repoSelect.value;
    rememberRepo(id);
    initRepo(id);
  });

  $addRepoBtn.addEventListener('click', () => { if (!isBusy) openForm('add', null); });
  $editRepoBtn.addEventListener('click', () => {
    if (!isBusy) openForm('edit', entriesById.get($repoSelect.value));
  });
  $rfDetect.addEventListener('click', runDetect);
  $rfCandidates.addEventListener('change', () => { $rfBlocks.value = $rfCandidates.value; });
  $rfSave.addEventListener('click', saveForm);
  $rfRemove.addEventListener('click', removeCurrentRepo);
  $rfCancel.addEventListener('click', closeForm);

  // --- Initial load ---
  entriesById = await loadRegistry(token);

  let initialRepo = DEFAULT_REPO;
  try {
    const saved = localStorage.getItem(REPO_STORAGE_KEY);
    if (saved && entriesById.has(saved)) initialRepo = saved;
  } catch { /* ignore */ }
  rebuildRepoSelect(initialRepo);
  await initRepo(initialRepo);
}());
