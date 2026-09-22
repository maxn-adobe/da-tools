// GitHub client for block-index: reads a repo's block folders (for the own/milo tiers) and
// auto-detects a new repo's blocks path when adding one. All unauthenticated (public repos).

import { ORG, BLOCKS_EXCLUDE } from '../lib/config';

export type DetectError = 'rate-limit' | 'not-found' | 'network';
export interface DetectSuccess {
  ref: string;
  candidates: string[];
  truncated: boolean;
}
export type DetectResult = DetectSuccess | { error: DetectError };

interface GitHubContentItem { type: string; name: string }
interface GitHubTreeItem { path: string; type: string }
interface GitHubTree { tree?: GitHubTreeItem[]; truncated?: boolean }
interface GitHubRepoMeta { default_branch: string }

// Lower-cased names of the immediate subdirectories at a GitHub contents URL (the block names).
export async function fetchGitHubDirNames(url: string): Promise<string[]> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const items = (await resp.json()) as GitHubContentItem[];
    return items.filter((i) => i.type === 'dir').map((i) => i.name.toLowerCase());
  } catch {
    return [];
  }
}

async function fetchRepoMeta(id: string): Promise<{ meta: GitHubRepoMeta } | { error: DetectError }> {
  try {
    const resp = await fetch(`https://api.github.com/repos/${ORG}/${id}`);
    if (resp.status === 403) return { error: 'rate-limit' };
    if (!resp.ok) return { error: 'not-found' };
    return { meta: (await resp.json()) as GitHubRepoMeta };
  } catch {
    return { error: 'network' };
  }
}

async function fetchTree(id: string, ref: string): Promise<GitHubTree | null> {
  try {
    const resp = await fetch(`https://api.github.com/repos/${ORG}/${id}/git/trees/${ref}?recursive=1`);
    if (!resp.ok) return null;
    return (await resp.json()) as GitHubTree;
  } catch {
    return null;
  }
}

// Resolve { ref, candidates:[blocksPath...], truncated } for a repo, or { error }. Prefers the
// stage branch (what the tool reads by default), falling back to the repo's default branch.
export async function detectRepo(id: string): Promise<DetectResult> {
  const metaResult = await fetchRepoMeta(id);
  if ('error' in metaResult) return { error: metaResult.error };
  const refs = ['stage', metaResult.meta.default_branch].filter((v, i, a) => v && a.indexOf(v) === i);
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
