# Serving these tools via AEM Edge Delivery + da.live

This repo is a container for standalone Vite/React **tools** (it does **not** use the EDS content pipeline). Each tool is served as static files from the Edge Delivery **code bus** and embedded in da.live as an app.

## URLs

Each tool builds to `<tool>/dist/` and is served at that subfolder path:

| Tool | In da.live (primary) | Direct (delivery) |
|---|---|---|
| `doc-generator` | https://da.live/app/maxn-adobe/pdp-document-generator/doc-generator/dist/index | https://main--pdp-document-generator--maxn-adobe.aem.live/doc-generator/dist/index.html |
| `hello` | https://da.live/app/maxn-adobe/pdp-document-generator/hello/dist/index | https://main--pdp-document-generator--maxn-adobe.aem.live/hello/dist/index.html |
| `template-generator` | https://da.live/app/maxn-adobe/pdp-document-generator/template-generator/dist/index | https://main--pdp-document-generator--maxn-adobe.aem.live/template-generator/dist/index.html |

Append `?ref=<branch>` to the da.live URL (or use `<branch>--pdp-document-generator--maxn-adobe.aem.live` for the direct URL) to view a non-`main` branch.

## How it works (the parts that matter)

- **Two kinds of files:** *code* (this repo's built files, mirrored to the code bus by AEM Code Sync) vs *content* (authored docs — not used by these tools).
- **Two tiers:** a **preview** tier (`…aem.page` / `…preview.da.live`) and a **live** tier (`…aem.live`). Code is served on both automatically once Code Sync mirrors it — there is no separate "publish" step for code.
- **da.live embedding:** `da.live/app/{org}/{repo}/{path}` loads the "Nx Shell", which iframes `https://{ref}--{repo}--{org}.preview.da.live/{path}.html` and injects the DA auth token via `nx/utils/sdk.js`. So the app URL `…/hello/dist/index` loads `…preview.da.live/hello/dist/index.html`.

## Per-tool subfolder layout

Each tool is a self-contained Vite app that builds into its own `<tool>/dist/` folder:

- `<tool>/index.html` — the Vite source template (standard entry; used for `npm run dev` and the build).
- `<tool>/dist/index.html` — the **built** entry (committed). References `/<tool>/dist/assets/*`. Do not hand-edit — rebuild.
- `<tool>/dist/assets/*`, `<tool>/dist/favicon.svg` — built assets (committed).

The one rule: each tool's production **`base` must equal its served subfolder** (`/<tool>/dist/`), so the built HTML references its assets with correct absolute paths. In dev the base is `/`.

This mirrors the proven `adobecom/da-express-milo` pattern, which serves tools at `tools/<tool>/dist/index.html`.

> **Note (previously believed otherwise):** an earlier iteration of the doc generator placed its built entry at the repo **root** because a subfolder `/dist/index.html` appeared to 404 on the preview tier. That 404 was a **Code Sync sync-timing artifact** (the file wasn't on the code bus yet), *not* a platform rule. Subfolder `.html` files serve fine — confirmed on this repo (`/doc-generator/dist/index.html`, `/hello/dist/index.html`) and on the reference repo. No root-entry workaround or postbuild step is needed.

## One-time setup (per repo — already done for this repo)

The site is registered once for the **whole repo**; individual tools need no extra registration.

1. Add `fstab.yaml` at the repo root, on the default branch (`main`).
2. Register the EDS site **once** via the Admin API:
   ```
   PUT https://admin.hlx.page/config/maxn-adobe/sites/pdp-document-generator.json
   x-auth-token: <token from an admin.hlx.page/auth/adobe login>
   {"code":{"owner":"maxn-adobe","repo":"pdp-document-generator"},
    "content":{"source":{"url":"https://content.da.live/maxn-adobe/pdp-document-generator/","type":"markup"}}}
   ```
3. Install **AEM Code Sync** on the repo. If it isn't syncing (no commit activity; delivery returns `code-bus: 404`), **remove + re-add** the repo in the app's settings to force the initial sync.

## Troubleshooting (read the `x-error` response header)

```bash
curl -sS -D - -o /dev/null "https://main--pdp-document-generator--maxn-adobe.aem.live/hello/dist/index.html" | grep -i "x-error\|HTTP/"
```

| `x-error` | Meaning | Fix |
|---|---|---|
| `Missing configuration` / `no such site` | Site not registered | Do setup step 2 |
| `failed to load /<tool>/dist/… from code-bus: 404` | The file isn't on the code bus — either not committed/pushed, or Code Sync hasn't synced yet | Confirm the file is committed under `<tool>/dist/`, push, wait ~1–2 min; if Code Sync shows no activity, re-add the repo (step 3) |
| `failed to load /index.md from content-bus: 404` (on `/`) | Healthy — config resolves, there's just no homepage doc | n/a |

## Admin API auth

Log in at `https://admin.hlx.page/auth/adobe`, copy the `auth_token` cookie, send it as the `x-auth-token` header. `GET /profile` is the hello-world (200 = token valid). The whole admin API is auth-gated.
