// Shared types for block-index.

// A minimal registry entry — only the fields that can't be derived from the repo id. Stored in
// the shared repos.json and expanded by deriveConfig() into a RepoConfig.
export interface RepoEntry {
  id: string;
  label?: string;
  blocksPath?: string;
  ref?: string;
  color?: string;
  usesMilo?: boolean;
}

export interface KitchenSink {
  lsPath: string;
  base: string;
}

export interface Tier {
  label: string;
  github: string;
  kitchenSink: KitchenSink;
}

export interface OwnColor {
  text: string;
  bg: string;
  border: string;
}

// The fully-derived config the rest of the tool consumes.
export interface RepoConfig {
  id: string;
  label: string;
  scanRoot: string;
  auditDir: string;
  ownColor: OwnColor;
  own: Tier;
  milo: Tier | null;
}

export interface RepoBlocks {
  own: Set<string>;
  milo: Set<string>;
}

export type KitchenSinkBlocks = RepoBlocks | null;

// One directory's cached scan (audit-<dir>.json).
export interface AuditRecord {
  scannedAt: string;
  docCount: number;
  scanErrors: number;
  repoBlocks: { own: string[]; milo: string[] };
  blocks: Record<string, string[]>;
  statusCheckedAt?: string;
  publishedPaths?: string[];
}

// A directory's state in the UI: not yet scanned (null), in progress ('scanning'), or a result.
export type DirPart = AuditRecord | 'scanning' | null;

export interface MergedData {
  blocks: Record<string, string[]>;
  docCount: number;
  scanErrors: number;
  publishedPaths: string[] | null;
}

export type SortKey = 'usage' | 'repo' | 'alpha';
