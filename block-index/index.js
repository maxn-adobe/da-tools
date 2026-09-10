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

// Every scannable repo is modelled as two block tiers: the site's own blocks + the milo
// foundation blocks it consumes. da-express-milo and da-dc are both milo-based, so only the
// "own" tier differs between them. Adding another milo-based site is just another REPOS entry.
const MILO_TIER = {
  label: 'milo',
  github: 'https://api.github.com/repos/adobecom/milo/contents/libs/blocks?ref=stage',
  kitchenSink: {
    lsPath: '/adobecom/milo/docs/library/kitchen-sink',
    base: 'https://main--milo--adobecom.aem.live',
  },
};

const REPOS = {
  'da-express-milo': {
    id: 'da-express-milo',
    label: 'Express (da-express-milo)',
    scanRoot: '/adobecom/da-express-milo',
    auditDir: '/adobecom/da-express-milo/drafts/da-test-tool-maxn-01',
    legacyAuditPath: '/adobecom/da-express-milo/drafts/da-test-tool-maxn-01/audit-results.json',
    ownColor: { text: '#fec311', bg: 'rgba(254, 195, 17, 0.1)', border: 'rgba(191, 146, 13, 0.25)' },
    own: {
      label: 'da-express-milo',
      github: 'https://api.github.com/repos/adobecom/da-express-milo/contents/express/code/blocks?ref=stage',
      kitchenSink: {
        lsPath: '/adobecom/da-express-milo/docs/library/kitchen-sink',
        base: 'https://main--da-express-milo--adobecom.aem.live',
      },
    },
    milo: MILO_TIER,
  },
  'da-dc': {
    id: 'da-dc',
    label: 'Acrobat / DC (da-dc)',
    scanRoot: '/adobecom/da-dc',
    // da-dc's drafts folder is not writable for all authors, so the scan cache is stored in the
    // da-express-milo drafts folder this tool already owns. Scanning da-dc needs only *read* access.
    auditDir: '/adobecom/da-express-milo/drafts/da-test-tool-maxn-01/da-dc',
    legacyAuditPath: null,
    ownColor: { text: '#e34850', bg: 'rgba(227, 72, 80, 0.1)', border: 'rgba(227, 72, 80, 0.28)' },
    own: {
      label: 'da-dc',
      github: 'https://api.github.com/repos/adobecom/da-dc/contents/acrobat/blocks?ref=stage',
      kitchenSink: {
        lsPath: '/adobecom/da-dc/docs/library/kitchen-sink',
        base: 'https://main--da-dc--adobecom.aem.live',
      },
    },
    milo: MILO_TIER,
  },
};

const $repoSelect = document.getElementById('repo-select');
const $scanAllBtn = document.getElementById('scan-all-btn');
const $statusBtn = document.getElementById('status-btn');
const $status = document.getElementById('status');
const $blockCount = document.getElementById('block-count');
const $legend = document.getElementById('legend');
const $results = document.getElementById('results');
const $dirDetails = document.getElementById('dir-details');
const $dirList = document.getElementById('dir-list');
const $sortSelect = document.getElementById('sort-select');

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
    fetchGitHubDirNames(cfg.milo.github),
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
    ls(cfg.milo.kitchenSink.lsPath, token).catch(() => []),
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
    <span class="legend-milo"><span class="legend-express-square">■</span> ${cfg.milo.label}</span>
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

(async function main() {
  const { token } = await DA_SDK;

  // --- Per-repo state (reset by initRepo on every repo switch) ---
  let cfg = REPOS[DEFAULT_REPO];
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
    cfg = REPOS[repoId] || REPOS[DEFAULT_REPO];

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

    if (cfg.legacyAuditPath) {
      // Migrate legacy audit-results.json → audit-express.json on first load (express only).
      const expressData = await readJson(auditPath('express'), token);
      if (!expressData && dirs.includes('express')) {
        const legacy = await readJson(cfg.legacyAuditPath, token);
        if (legacy) {
          await writeJson(auditPath('express'), legacy, token);
          dirParts.express = legacy;
        }
      } else {
        dirParts.express = expressData || null;
      }
      await Promise.all(
        dirs.filter((d) => d !== 'express').map(async (dir) => {
          dirParts[dir] = await readJson(auditPath(dir), token);
        }),
      );
    } else {
      await Promise.all(
        dirs.map(async (dir) => {
          dirParts[dir] = await readJson(auditPath(dir), token);
        }),
      );
    }

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
    try { localStorage.setItem(REPO_STORAGE_KEY, id); } catch { /* ignore */ }
    initRepo(id);
  });

  // --- Initial load ---
  let initialRepo = DEFAULT_REPO;
  try {
    const saved = localStorage.getItem(REPO_STORAGE_KEY);
    if (saved && REPOS[saved]) initialRepo = saved;
  } catch { /* ignore */ }
  $repoSelect.value = initialRepo;
  await initRepo(initialRepo);
}());
