# pdp-document-generator — DA tools container

A container repository that hosts **multiple standalone DA (Document Authoring) tools** side-by-side. Each tool is its own self-contained Vite + React app in its own top-level folder, built to `<tool>/dist/`, served as static files from AEM Edge Delivery Services (the "code bus"), and embedded in DA at its own URL.

## Tools

| Tool | Folder | Opens in DA at |
|---|---|---|
| **Document Generator** — bulk-generate DA pages from product data + templates | [`doc-generator/`](./doc-generator/) | https://da.live/app/maxn-adobe/pdp-document-generator/doc-generator/dist/index |
| **Template Generator** — fill a template's `{{tokens}}` from any spreadsheet/JSON | [`template-generator/`](./template-generator/) | https://da.live/app/maxn-adobe/pdp-document-generator/template-generator/dist/index |
| **Hello** — minimal proof-of-concept app | [`hello/`](./hello/) | https://da.live/app/maxn-adobe/pdp-document-generator/hello/dist/index |

Append `?ref=<branch>` to preview a non-`main` branch, e.g. `…/hello/dist/index?ref=my-branch`.

## Repository layout

```
pdp-document-generator/
├─ doc-generator/          # tool 1 — self-contained Vite app
│  ├─ src/  index.html  vite.config.ts  package.json
│  └─ dist/{ index.html, assets/ }   # built output (committed)
├─ hello/                  # tool 2 — self-contained Vite app
│  ├─ src/  index.html  vite.config.ts  package.json
│  └─ dist/{ index.html, assets/ }   # built output (committed)
├─ template-generator/     # tool 3 — generic {{token}} → DA document generator
│  ├─ src/  index.html  vite.config.ts  package.json
│  └─ dist/{ index.html, assets/ }   # built output (committed)
├─ fstab.yaml              # repo-level: registers the EDS site
├─ SERVING.md              # repo-level: how serving works + troubleshooting
└─ README.md
```

Each tool is independent: its own `package.json`, `node_modules`, Vite config, and build. There is intentionally **no** root `package.json` — you work inside a tool's folder.

## Working on a tool

```bash
cd doc-generator      # or: cd hello
npm install
npm run dev           # local dev server
npm run build         # compiles to ./dist (commit the result)
```

The built `dist/` is committed because AEM Code Sync serves the repo's files directly (there is no CI build step). After `npm run build`, commit the updated `<tool>/dist/` and push — Code Sync mirrors it to the code bus in ~1–2 min.

## Adding a new tool

1. Create a new top-level folder `my-tool/` as a standard Vite + React app (copy `hello/` as a starting point).
2. In its `vite.config.ts`, set the production `base` to the served subfolder:
   ```ts
   const base = command === 'serve' ? '/' : '/my-tool/dist/'
   ```
3. `npm install && npm run build` inside the folder, commit `my-tool/` (including `dist/`), and push.
4. It's live at `https://da.live/app/maxn-adobe/pdp-document-generator/my-tool/dist/index`.

No per-tool site registration is needed — the whole repo is one EDS site (see [SERVING.md](./SERVING.md)).

## Serving

All tools are served through AEM Edge Delivery Services and embedded in da.live. See **[SERVING.md](./SERVING.md)** for how it works (site registration, Code Sync, the per-tool subfolder pattern) and an `x-error` troubleshooting table.
