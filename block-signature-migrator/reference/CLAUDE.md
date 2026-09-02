# Block Migration Tool — Project Memory

A bulk **block-signature migration tool** for adobe.com/express content authored in
Document Authoring (DA / da.live), the authoring layer for Edge Delivery Services (EDS).

When a developer changes a block's contract in code (to clean up the codebase), every
already-authored instance of that block across ~12,000 documents and all locales still
carries the **old** signature. This tool lets an author find every instance of that block
and migrate them to the **new** signature in bulk, then preview and publish the result.

> Full architecture, rationale, the detailed build plan, the schema field vocabulary, and
> two worked examples live in `docs/design.md`. **Read it before starting a new build phase.**

## Repositories

- **This repo** is the migration tool (a separate codebase: content reader, parser,
  transform engine, UI, governance).
- **Block schemas live in the EDS site repo**, colocated with each block
  (`blocks/<name>/<name>.schema.json`), versioned alongside the contract they describe.
  This tool *consumes* them; how it accesses them is an open decision (see `docs/design.md`).

## What this tool is — and is not

- It operates on **block instances as structured objects**, not on page text.
- Every edit is a **typed structural transform**: rename a key, add / remove / reorder a
  field, rename a block or variant, normalize a value, split / merge cells.
- It is **NOT** a free-text find-and-replace. There is no "replace any string anywhere"
  operation. Editorial content (prose, images) is carried along when cells move but is
  **never rewritten**.

## Non-negotiable invariants

These hold everywhere in the codebase. Do not violate them; flag any request that would.

1. **Read-only until Phase 4.** Phases 0–3 must never write to, preview, or publish any DA
   document. Confidence in parse → schema → diff comes before any mutation.
2. **Schema is the source of truth for a block's shape.** Never infer a cell's role from
   table shape at runtime — shape is ambiguous (two columns could be key/value, two
   side-by-side columns, or image+text). Resolve roles via the block's schema only.
3. **Operate on roles, never raw cell indices.** Match and transform instances by their
   schema-defined role/key so that localized and drifted instances are handled correctly.
4. **Conformance-gate all writes.** Only instances that conform to their schema may be
   auto-migrated. Non-conforming ("outlier") instances are surfaced for a human and are
   never transformed blindly.
5. **Cross-locale by default.** Block keys and structure are language-agnostic tokens,
   identical across locales; a migration must apply to ALL locales (skipping some breaks the
   block there). Keys/structure are universal; *values* may be localized — never assume a
   value is the same across locales.
6. **No commit without a reviewable diff.** Every change flows through a previewable
   changeset with per-instance veto before anything is written.
7. **Detect staleness.** Re-read each document at write time; abort the write if it changed
   since it was parsed.

## Core concepts / vocabulary

- **EDS block**: in DA a block is a table. The first cell of the first row is the block name
  (with an optional variant in parentheses, e.g. `Columns (highlight)`). After decoration the
  block is a `<div>`; its children are rows (`<div>`s); each row's children are cells
  (`<div>`s). The block's JS decorator reads this grid — **the code IS the contract.**
- **Pattern** — how a block reads its grid:
  `key-value` (left cell = key, right = value), `positional-columns` (one row, cells =
  columns), `positional-rows` (each row = a repeated item), `single-cell`, or `mixed`.
- **Cell roles** — keep these distinct; "metadata" is overloaded in EDS:
  - page **Metadata** block (emits `<meta>` tags)
  - **Section Metadata** (section-level config)
  - a block's own **key/value config** (part of its contract)
  - **editorial content** (the prose/images the block renders)

  A signature migration manipulates the first three structurally and leaves editorial
  content alone.
- **The core primitive** — *parse an instance → compare it to its schema.* Inference, the
  conformance audit, and post-migration validation are all this one operation. **Build it
  first; everything reuses it.**

## Schema registry

- Machine-readable JSON, **one file per block, colocated in the site repo**:
  `blocks/<name>/<name>.schema.json`.
- **Not** JSDoc/prose (it must diff into operations) and **not** a DA document (the contract
  is defined by code; a DA doc has no CI anchor and would drift). Human-readable docs may be
  *generated from* the schema.
- **Bootstrapped by inference, then human-curated**: an agent reads each `block.js` for the
  *intended* shape; the crawler observes *actual* shapes across instances; the two are
  reconciled into a draft. Commit schemas as a single **additive, behavior-neutral PR**.
- A schema carries a `version`, so old vs new can be diffed. **The schema diff is the
  migration spec.**
- Going-forward rule (for the site repo): **changing a block's contract updates its schema
  in the same PR.**
- Field vocabulary + the `logo-row` worked example: see `docs/design.md`.

## Migration: two layers (not rivals)

- **Manual transform (imperative)** — the engine. The author builds an op sequence by hand
  from the transform palette. Works with zero schema. **Build this first.**
- **Schema-diff (declarative)** — autopilot on top of the engine. The tool reads a block's
  old→new schema, pre-fills the ops, and the author supplies only what a diff can't know
  (backfill values, ambiguous renames) and reviews. Because it knows the target, it
  validates that each migrated instance conforms to the new schema. **Layer this on later.**

## Build phases

Read-only through Phase 3. **Start narrow** — prove the whole pipeline on TWO representative
blocks (one positional, one key/value) before scaling to ~100.

- **Phase 0** — Block-instance parser + DA content-read layer (the core primitive). ← start here
- **Phase 1** — Bootstrap the schema registry by inference; curate; commit to the site repo.
- **Phase 2** — Conformance / drift audit (read-only). Doubles as validation of Phases 0–1.
- **Phase 3** — Migration engine as dry-run / diff only (no writes); manual ops first.
- **Phase 4** — Write-back + governance (preview → publish → rollback). The only mutating
  phase; conformance-gated; staleness-checked.
- **Phase 5** — Schema-diff autopilot + the remaining blocks.

**Current phase: 0** — update this as you progress.

## EDS / DA integration

- DA stores documents as HTML. Read/write document source via the DA Admin API
  (`admin.da.live`). **Verify exact endpoints, auth, and payloads against current DA docs
  before relying on them — do not assume.**
- Preview/publish via the AEM (Helix) Admin API (`admin.hlx.page` / `admin.aem.live`):
  `*.page` = preview, `*.live` = production. Rollback uses DA version history.
- **Expand/contract coordination**: code and content deploy separately, but the contract
  couples them. New block code must read BOTH old and new signatures, be deployed, THEN the
  content is migrated with this tool, THEN old-signature support is removed. This tool is the
  "contract" phase. Preview (`*.page`) verifies migrated instances against the deployed code.

## Stack & conventions

> **FILL IN before Phase 0.** Record the tool's own stack and layout here once chosen:
> - Language / runtime:
> - UI framework (if any):
> - How the tool runs (local CLI / internal web app / service):
> - DA & AEM API auth mechanism + where secrets live:
> - Test command:
> - Lint / format command:
> - Source layout for the tool:
