// Shared types for block-manager.

// A minimal registry entry — only the fields that can't be derived from the repo id. Stored in
// the shared repos.json and expanded by deriveConfig() into a RepoConfig. `addedBy` is the email of
// whoever added it (from the da.live SDK), used for advisory edit/remove gating.
export interface RepoEntry {
  id: string;
  blocksPath?: string;
  ref?: string;
  addedBy?: string;
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

// The fully-derived config the rest of the tool consumes.
export interface RepoConfig {
  id: string;
  label: string;
  scanRoot: string;
  auditDir: string;
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
  // blockName -> variant token -> doc paths. Token '(none)' holds variant-less instances.
  // Optional on read so any legacy record without it (e.g. a pre-variant scan) still parses.
  variants?: Record<string, Record<string, string[]>>;
  statusCheckedAt?: string;
  publishedPaths?: string[];
}

// A directory's state in the UI: not yet scanned (null), in progress ('scanning'), or a result.
export type DirPart = AuditRecord | 'scanning' | null;

export interface MergedData {
  blocks: Record<string, string[]>;
  // blockName -> variant token -> doc paths, merged across directories.
  variants: Record<string, Record<string, string[]>>;
  docCount: number;
  scanErrors: number;
  publishedPaths: string[] | null;
}

export type SortKey = 'usage' | 'repo' | 'alpha';
