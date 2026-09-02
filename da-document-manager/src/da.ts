// Minimal DA auth-token store for the scaffold. The token is set once at startup — from the
// da.live "Nx Shell" SDK when embedded in DA, or from VITE_DA_TOKEN when running locally — and
// read by components via getToken(). Grow this into a full DA API client as the tool is built out
// (see da-document-generator/src/api/daApi.ts and pdp-document-generator for the eventual shape).
let token: string | null = null;

export function getToken(): string | null {
  return token ?? import.meta.env.VITE_DA_TOKEN ?? null;
}

export function setToken(t: string | null): void {
  token = t;
}
