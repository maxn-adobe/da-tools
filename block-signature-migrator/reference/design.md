# Block Migration Tool — Design

This is the full rationale behind `CLAUDE.md`. Read it before starting a new build phase.
`CLAUDE.md` holds the rules; this holds the *why* and the detail.

---

## 1. Purpose & scope

A bulk **block-signature migration tool** for adobe.com/express, whose content is authored in
Document Authoring (DA / da.live) on top of Edge Delivery Services (EDS).

The driving use case is **codebase cleanup**: a developer changes a block's contract in code,
and now every already-authored instance of that block — across ~12,000 documents and every
locale — still carries the *old* signature. An author needs to migrate all of those instances
to the *new* signature, in bulk, safely, and then preview and publish them.

**Scope decision: this tool does not do general content find-and-replace.** That was an early
"while we're at it" idea and it has been deliberately cut. Dropping it is what makes the tool
both safer and more powerful, because every edit becomes a *typed structural transform on a
block instance* rather than a blind string replacement — see §2.

---

## 2. The core reframe: structural, not textual

Once the tool only ever touches blocks-as-contracts, the unit of work stops being "a string
match somewhere on a page" and becomes "a block instance, parsed into named fields." Editing
is then a small, closed set of **structural operations**:

- rename a key (key/value blocks)
- add a field/key with a default or empty value (backfill a newly required key)
- remove a deprecated field/key
- reorder cells/columns (positional contract change)
- rename the block, or rename a variant
- set / normalize the value of a **specific** field (the only op that resembles find-replace,
  but scoped to one known role — supports a value map or a regex applied to that field only)
- split a cell / merge cells
- add / remove a row (for `positional-rows` / repeating blocks)

This is a content **codemod** — closer to `ALTER TABLE` or a jscodeshift transform than to
find-and-replace. The whole class of "did I just rewrite a French sentence" problems
disappears, because the tool never operates on free text — only on cells addressed by their
role in the block.

---

## 3. Repositories & schema access

Two codebases are involved:

- **The tool** (this repo): content reader, instance parser, transform engine, conformance
  checker, UI, governance/write-back.
- **The EDS site repo**: where the block JS/CSS live, and where the **schemas live too**
  (`blocks/<name>/<name>.schema.json`), versioned alongside the contract.

**Open decision — how the tool reads the schemas.** Options:
1. Tool clones / submodules / pulls the site repo and reads the `*.schema.json` files directly.
2. A build step in the site repo aggregates all schemas into one published manifest that the
   tool fetches.
3. (Avoid) The tool vendors its own copy — reintroduces drift.

Lean toward 1 or 2 so the schema in the site repo stays the single source of truth.

---

## 4. Scale, locales, and the real hard problem

~12k documents *including* all localized pages is **small data**. Index it for snappy querying
if you like, but it is not a scaling wall — you could batch-process the whole corpus. (Whether
to build a content index at all, vs. crawl-on-demand, is an open decision; at this size either
is fine.)

**Cross-locale is required, not merely allowed.** A block's keys and structure are
language-agnostic tokens — `cta-label` is `cta-label` in en, fr, and ja. Migrating only some
locales would break the block in the ones you skipped. So:

- Treat **keys and structure as universal** across locales.
- Treat **values as per-instance** — a value may be translated even when the key is not; never
  assume a value matches across locales.

The genuine difficulty is therefore **structural variation across instances**, not volume:
localized authoring drift, optional fields present in some instances and not others, and
hand-mangled tables. This is exactly why the tool matches on *roles via the schema* and
**quarantines non-conforming instances into an outliers bucket** for a human (see §7) rather
than blindly transforming cell positions.

---

## 5. The schema registry

### 5.1 Format & location

Machine-readable **JSON**, one small file per block, colocated in the site repo:
`blocks/<name>/<name>.schema.json`.

- **Not** prose annotations (JSDoc): prose does not *diff* into operations, and the schema-diff
  migration (§6) depends on a mechanical old→new diff.
- **Not** a DA document as the source of truth: the contract is defined by the *code*, so the
  schema must live somewhere a CI check can flag divergence. A DA doc has no such anchor and
  will rot. A human-readable doc *generated from* the schema is fine.
- A JS/TS sidecar that exports the same object is a reasonable alternative if you want the block
  itself to import and self-validate at runtime; JSON is simpler for an external tool to fetch.

### 5.2 Field vocabulary (starting point — standardize during Phase 1)

Per block, per version:

- `block` — canonical block name.
- `version` — integer; lets old and new signatures be diffed.
- `pattern` — `key-value` | `positional-columns` | `positional-rows` | `single-cell` | `mixed`.
- `variants` — author-written variant tokens (the parenthetical in the block name). Tokens the
  *decorator computes* are NOT variants — see `modifiers`.
- For `key-value`: `fields[]` of `{ key, type, required, enum?, description }`.
- For positional patterns: `cells[]` of `{ index, role, content, required, repeats?, description }`.
- `rows` — for positional blocks, expected row count / repetition semantics.
- `modifiers[]` — classes the decorator applies based on content, e.g.
  `{ name, authored: false, appliedWhen }`. These are behavioral states, not authoring inputs.

### 5.3 Worked example — `logo-row`

The decorator (`blocks/logo-row/logo-row.js`):

- reads `block.children[0]` — **one row**; any further rows are ignored;
- destructures that row into exactly **two cells** `[textColumn, imageColumn]` — positional;
- treats cell 0 as a text/heading column and cell 1 as a collection of `<img>` logos;
- adds a `numerous` class when the image column has **more than 5** images.

There are **no keys and no metadata** — it is a purely positional, purely editorial block. (This
is exactly the case where a "two columns = metadata" heuristic would be wrong: these are two
*positional* columns, not key|value.) A contract change to this block would be *structural*
(add / reorder / remove a column), which is why the schema addresses cells by `index` + `role`.

Inferred schema:

```json
{
  "block": "logo-row",
  "version": 1,
  "pattern": "positional-columns",
  "variants": [""],
  "rows": { "count": 1, "note": "Only the first row is read; further rows are ignored." },
  "cells": [
    { "index": 0, "role": "text-column",  "content": "richtext", "required": true,
      "description": "Heading/label shown beside the logos." },
    { "index": 1, "role": "image-column", "content": "image", "repeats": true, "required": true,
      "description": "Brand logo images." }
  ],
  "modifiers": [
    { "name": "numerous", "authored": false, "appliedWhen": "image-column has > 5 images" }
  ]
}
```

Note the sharp conformance rule this implies: an instance whose first row has only one cell
makes `imageColumn` undefined and the decorator **throws** at runtime. So "row 0 has exactly 2
cells" is a hard rule with real consequences — precisely the kind of thing the Phase 2 audit
must catch.

### 5.4 Bootstrapping by inference

Do not hand-write ~100 schemas. Derive drafts from two complementary sources:

- **From the code** — an agent reads each `block.js` and observes how it reaches into the table
  (which `children[i]` it indexes, whether it loops rows as repeated items, whether it matches
  the first cell's text as a key) and emits a structured draft of the *intended* shape.
- **From the content** — crawl the instances and cluster the shapes each block+variant actually
  takes in the wild (cell counts; which cells are images / links / short key-like tokens /
  prose). This is the *de-facto* shape.

Reconcile the two into one draft per block; a human curates; commit as a single additive,
behavior-neutral PR. (The gap between intended and de-facto is itself drift — see §7.)

### 5.5 The schema diff *is* the migration spec

Because each schema carries a `version`, the tool can read old vs new and derive the
transform. This drives the declarative migration mode in §6.2.

---

## 6. Migration: two layers

### 6.1 Manual transform (imperative) — the engine

The author picks a block and builds an op sequence by hand from the palette in §2. The author
is *telling the tool what changed*. This is maximally flexible, requires no maintained schema,
and works on blocks not yet documented — but the human must know and correctly encode the
delta, and the tool cannot validate the result against a target it doesn't know. **Build this
first.**

### 6.2 Schema-diff (declarative) — autopilot

Illustrative example (the block and keys below are made up for illustration). A dev renames a
key `cta-label` → `button-text` on a `marquee` block and adds a new required key `button-style`
defaulting to `primary`; ~1,847 instances exist across locales.

The dev has already bumped `marquee.schema.json` from v1 to v2 inside the contract PR. When the
author opens the tool and selects `marquee`, it reads v1-vs-v2 and announces:

> Contract changed v1 → v2. Renamed: `cta-label` → `button-text`. New required key
> `button-style` (no default in schema — choose a backfill value).

The ops come pre-filled. The author supplies only what a diff can't know (the backfill value;
confirming an ambiguous rename) and reviews. Because the tool knows the *target*, after applying
it validates that each migrated instance now conforms to v2 and flags any that don't.

Either way, the per-instance artifact the author reviews is the same structural grid diff:

```
marquee (before)                    marquee (after)
| cta-label | "Get Express" |   →   | button-text  | "Get Express" |
                                    | button-style | primary       |   ← added
```

### 6.3 The relationship

These are not rivals. **Manual transforms are the engine; schema-diff is autopilot that writes
the op sequence for you from the declared delta**, and drops you into that same pre-populated op
list where you can still hand-edit. Build manual first; layer schema-diff on top once schemas
exist.

---

## 7. Conformance / drift audit

The schema says how a block *should* be authored. Reality, across 12k instances and many
locales, drifts: a missing optional key, an extra row, a legacy or typo'd variant name,
reordered cells, a deprecated block name still in use, a locale with an extra field. The audit
runs every instance against its block's schema and buckets them **conforming vs. non-conforming,
with a reason per non-conformer**.

This is **not** an optional analytics feature for this tool — it is the safety substrate for the
migration. The migration finds cells *by their role*, which only works on conforming instances;
the non-conforming ones are exactly where a blind transform misfires. The audit is what
separates *"1,790 instances are clean and safe to auto-migrate"* from *"57 are weird, route them
to a human"* — i.e., it **is** the outliers bucket. Some conformance checking is therefore in
v1 by necessity.

What is optional (a fast-follow) is the **elevation**: a standalone audit dashboard you run
independent of any migration — survey content/codebase health, find every instance of a
deprecated block, quantify drift as tech debt to prioritize cleanup.

The audit also doubles as the read-only **validation of the parser and the schemas**: if "almost
everything is non-conforming," the schema (or parser) is wrong, not the content.

---

## 8. Governance

The unit of governance is a **changeset**: build a migration, review the full diff, veto
individual instances, then act on the set as a whole.

- **Preview** — push affected pages to `*.page`; verify in the real EDS preview.
- **Publish** — push to `*.live`.
- **Rollback** — via DA version history; the changeset is the unit you revert.
- **Audit trail** — who changed what, when.
- **Approval (optional)** — the person running a migration is not always the person allowed to
  publish; a changeset is a natural approval surface.
- **Staleness / conflict** — re-read each document at write time and abort if it changed since it
  was parsed.

---

## 9. Expand/contract deploy coordination

Code and content deploy separately in EDS, but the contract couples them:

- Ship new block code that reads `button-text` *before* content is migrated → every old
  instance breaks.
- Migrate content *before* the new code is deployed → the currently deployed code (still reading
  `cta-label`) breaks instead.

The clean pattern is **expand/contract (parallel change)**: ship code that reads BOTH keys,
deploy it, migrate the content with this tool at your leisure, then drop old-key support. This
tool is the **contract** phase. Preview (`*.page`) lets the author verify migrated instances
against the deployed code before publishing. Consider surfacing an "is the new contract
deployed?" check in the UI.

---

## 10. The core primitive

Inference-from-content (§5.4), post-migration validation (§6.2), and the conformance audit (§7)
are the **same operation**: *parse an instance, compare it to a schema.* Build that engine once
and all three fall out of it. It is the first thing to build, before any UI.

---

## 11. Build plan

Governing principle: **everything is read-only until Phase 4.** Earn confidence in parse →
schema → diff before mutating any live document. And **start narrow** — prove the entire
pipeline end-to-end on TWO representative blocks (one positional like `logo-row`, one key/value)
before scaling to ~100.

- **Phase 0 — Parser + content-read layer.** Given a document's HTML from DA, extract its block
  instances as structured grids (name, variant, rows × cells). Plus the read layer that
  enumerates and fetches all docs from DA. This is the core primitive of §10; everything reuses
  it. Read-only.
- **Phase 1 — Bootstrap the registry.** Run the two-source inference (§5.4), reconcile to drafts,
  human-curate, commit to the site repo as one additive PR. Validates the schema format against
  real blocks.
- **Phase 2 — Conformance/drift audit (read-only).** Build the comparator and bucket instances
  (§7). Safest thing to build; immediately useful; validates Phases 0–1.
- **Phase 3 — Migration engine, dry-run only.** Build the transform primitives (§2) operating on
  parsed instances in memory, plus the before/after diff. Output a previewable changeset —
  **no writes**. Manual/imperative ops first.
- **Phase 4 — Write-back + governance.** Wire the apply (write modified block tables back via the
  DA API), gated by per-instance veto and conformance; add preview → publish → rollback and the
  staleness check (§8). The only mutating phase.
- **Phase 5 — Schema-diff autopilot + remaining blocks.** Layer the declarative proposal (§6.2)
  on the manual engine; finish populating the registry.

---

## 12. EDS / DA technical reference

- **Block ↔ table.** In the source document a block is a table. First cell of the first row is
  the block name, with an optional variant in parentheses (`Columns (highlight)`). After
  decoration the block is a `<div class="<name> block">`; its children are rows (`<div>`s); each
  row's children are cells (`<div>`s). The block's JS `decorate(block)` reads this grid.
- **Sections & default content.** Documents are split into sections by horizontal rules (`---`).
  Content that isn't in a block table is "default content" (paragraphs, headings, lists, images,
  links). This tool focuses on blocks.
- **Metadata blocks.** A `Metadata` block emits page `<meta>` tags; `Section Metadata` sets
  section-level config. Both are key/value and distinct from a regular block's own config — keep
  the vocabulary straight (see `CLAUDE.md` → Core concepts).
- **DA content API.** Documents are stored as HTML; read/write source via the DA Admin API
  (`admin.da.live`). **Confirm exact endpoints, auth, and request/response shapes from current DA
  docs — do not assume.**
- **AEM (Helix) Admin API.** Preview/publish via `admin.hlx.page` / `admin.aem.live`; `*.page` =
  preview, `*.live` = production. DA keeps version history for rollback.

---

## 13. Open decisions

1. **Schema access** — how the tool reads schemas from the site repo (§3): direct repo read,
   submodule, or a published aggregated manifest.
2. **Index vs. crawl-on-demand** — at ~12k docs either works; decide whether a content index is
   worth the freshness-management cost.
3. **Schema-diff in v1 or fast-follow** — manual engine is required; the autopilot can come
   later (§6).
4. **Audit depth** — gating mechanism only (required) vs. a standalone health dashboard (§7).
5. **Where the tool runs & auth** — local CLI, internal web app, or service; how it authenticates
   to DA and AEM, and where secrets live.
6. **Permissions / approval** — who may run a migration, who may publish, scoping by directory.
7. **Schema vocabulary** — finalize content types, `modifiers`, repetition semantics, etc.,
   during Phase 1 against real blocks.
