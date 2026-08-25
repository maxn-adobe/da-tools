import type { TemplateValidation } from './api/daApi';

// _id is a string so it satisfies the string index signature
export type CsvRow = Record<string, string>;

/** How a generated document gets its content. */
export type RenderMode = 'bake' | 'metadata';

/** UI selection for the render mode — 'both' generates one doc per row per mode. */
export type ModeSelection = RenderMode | 'both';

export type RowStage =
  | 'pending'
  | 'generating'
  | 'generated'
  | 'qa-fail'
  | 'previewing'
  | 'previewed'
  | 'publishing'
  | 'published'
  | 'unpublishing'
  | 'unpublished'
  | 'deleting'
  | 'error';

export interface QaCheck {
  id: string;
  label: string;
  description: string;
  pass: boolean;
}

export interface QaResult {
  pass: boolean;
  checks: QaCheck[];
}

export interface RowResult {
  id: string;
  path: string;
  stage: RowStage;
  /** The render mode that produced this result row (bake vs metadata). */
  mode?: RenderMode;
  error?: string;
  editUrl?: string;
  previewUrl?: string;
  liveUrl?: string;
  qa?: QaResult;
}

/** Template input + fetch/validation state (App-level). */
export interface TemplateState {
  path: string;
  html: string | null;
  validation: TemplateValidation | null;
  error: string | null;
  loading: boolean;
}

/** Output-location configuration (App-level UI state). */
export interface OutputState {
  source: 'column' | 'dir';
  pathColumn: string;
  prefix: string;
  outputDir: string;
  slugColumn: string;
}
