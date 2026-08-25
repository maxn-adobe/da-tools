# Template Generator

A generic DA tool: fill a template document's `{{placeholder}}` tokens from a spreadsheet (CSV/XLSX) or JSON file and write the resulting documents to DA. A more general sibling of the [doc-generator](../doc-generator/), with the product-specific logic stripped out.

Opens in DA at: **https://da.live/app/maxn-adobe/pdp-document-generator/template-generator/dist/index**

## What it does

1. **Data** — upload a CSV/XLSX/JSON file (JSON may be an array of objects or a DA sheet `{ "data": [...] }`). Each column becomes a `{{column}}` token; pick which rows to generate.
2. **Template & target** — point at a DA template document (path or URL). The tool fetches it, lists its `{{tokens}}`, and flags any token with no matching data column. Choose the output location (an explicit path column such as `url`, or a fixed directory + slug column) and the render mode.
3. **Generate** — writes one document per selected row (versioning any existing doc first), then preview / publish per row or in bulk.

## Render modes

- **Bake** — substitutes values into the document body and resolves `#cta` links at generation time, and attaches page metadata with `sheet-powered` forced off. Self-contained static docs that render with **no runtime script**.
- **Metadata** — leaves `{{tokens}}` in the body and attaches a Metadata block of the row's values with `sheet-powered=Y`; the site's `content-replace.js` fills the tokens at render (how the Express color pages work today).
- **Both** — writes one doc per mode into `/baked/` and `/meta/` subfolders so the two can be compared side by side.

## Local dev

```bash
npm install
echo "VITE_DA_TOKEN=your_token_here" > .env.local   # needed for DA calls when run outside da.live
npm run dev      # port 3002
npm run build    # compiles to ./dist (commit the result)
```

Built output lives in `dist/` (committed) and is served at `/template-generator/dist/`. See the repo-level [../SERVING.md](../SERVING.md) for how serving works.

## Reuse

The DA API layer (`src/api/daApi.ts`), metadata-block builder (`src/lib/metadata.ts`), `applyTemplate` (`src/lib/generate.ts`), concurrency helper, token bootstrap, action hooks, and status pills are copied from `doc-generator`. The tool-specific logic lives in `src/lib/buildDoc.ts` (the bake/metadata builders + output-path resolution + QA) and `src/components/`.
