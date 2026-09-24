// Milestone-1 scaffold: only the DA auth-token module lives here for now so main.tsx can wire up
// the token handshake and the shell can gate on it. The full merged DA API (the generator's
// write/template helpers + the manager's crawl/status/bulk-mutate layers + daPathToProdUrl) lands
// in milestone 2, replacing this file. Token handling is consolidated here (the manager's separate
// src/da.ts is not ported).

let token: string | null = null;

export function getToken(): string | null {
  return token ?? import.meta.env.VITE_DA_TOKEN ?? null;
}

export function setToken(t: string | null): void {
  token = t;
}
