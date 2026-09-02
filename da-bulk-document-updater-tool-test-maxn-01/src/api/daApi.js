const DA_API = 'https://admin.da.live';

let token = null;

export function getToken() {
  return token ?? import.meta.env.VITE_DA_TOKEN ?? null;
}

export function setToken(t) {
  token = t;
}

export async function fetchDocument(path) {
  const t = getToken();
  if (!t) throw new Error('DA token not set — add VITE_DA_TOKEN to .env.local for local dev');
  const fullPath = path.endsWith('.html') ? path : `${path}.html`;
  const resp = await fetch(`${DA_API}/source${fullPath}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
  return resp.text();
}

export async function listDirectory(path) {
  const t = getToken();
  if (!t) throw new Error('DA token not set — add VITE_DA_TOKEN to .env.local for local dev');
  const resp = await fetch(`${DA_API}/list${path}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
  return resp.json();
}

export function urlToSourcePath(url) {
  if (url.includes('da.live')) {
    try {
      const u = new URL(url);
      if (u.hash.length > 1) {
        const fragment = u.hash.slice(1);
        return fragment.startsWith('/') ? fragment : `/${fragment}`;
      }
    } catch { /* fall through */ }
    const hashIdx = url.indexOf('#');
    if (hashIdx !== -1) {
      const fragment = url.substring(hashIdx + 1);
      return fragment.startsWith('/') ? fragment : `/${fragment}`;
    }
  }
  if (url.startsWith('/')) return url;
  if (!url.includes('://')) return `/${url}`;
  // AEM page/preview URL: https://main--repo--org.aem.page/path
  try {
    const u = new URL(url);
    const sub = u.hostname.split('.')[0];
    const parts = sub.split('--');
    const org = parts[parts.length - 1];
    const repo = parts[parts.length - 2];
    return `/${org}/${repo}${u.pathname}`;
  } catch {
    return url;
  }
}
