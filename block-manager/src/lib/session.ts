// Current-user identity from the da.live SDK payload — the shell forwards the authenticated IMS
// email alongside the token. Advisory only: used to attribute repo additions (`addedBy`) and to gate
// edit/remove in the UI. It is NOT a security boundary (client-side, and the shared repos.json is
// writable by anyone with folder access). Null when running standalone/local (no da.live shell).
let userEmail: string | null = null;

export function getUserEmail(): string | null {
  return userEmail;
}

export function setUserEmail(email: string | null): void {
  userEmail = email;
}
