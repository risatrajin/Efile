/**
 * Per-tab auth-token storage.
 *
 * Why ``sessionStorage`` and not ``localStorage``:
 *
 * Multiple users can log in simultaneously from the same browser when (a) a CPA
 * also has admin access, or (b) a physician opens their own portal alongside
 * an Admin / Partner workspace in another tab. ``localStorage`` is shared
 * across every tab on the same origin, so the second login was clobbering the
 * first tab's token and Authorization headers got cross-wired between roles.
 *
 * ``sessionStorage`` is naturally scoped to a single tab — different tabs see
 * different auth contexts, and closing the tab clears the token. Refreshing
 * the same tab keeps the user signed in (sessionStorage survives reloads).
 *
 * The legacy ``ct_token`` localStorage key is migrated on first read so users
 * with an existing session don't get bounced to the login screen.
 */
const TOKEN_KEY = "ct_token";

function safeGet(store, key) {
  try { return store?.getItem(key); } catch (_) { return null; }
}
function safeSet(store, key, val) {
  try { store?.setItem(key, val); } catch (_) {}
}
function safeRemove(store, key) {
  try { store?.removeItem(key); } catch (_) {}
}

export function getToken() {
  // Per-tab first; fall back to the legacy localStorage key for users who
  // were already signed in before the sessionStorage migration shipped.
  const tab = safeGet(typeof sessionStorage !== "undefined" ? sessionStorage : null, TOKEN_KEY);
  if (tab) return tab;
  const legacy = safeGet(typeof localStorage !== "undefined" ? localStorage : null, TOKEN_KEY);
  if (legacy) {
    // Promote into sessionStorage so subsequent reads in this tab are
    // isolated. We deliberately keep the localStorage copy untouched on the
    // first promotion so the *other* already-open tab can still read it; new
    // logins in any tab will overwrite their own sessionStorage only.
    safeSet(typeof sessionStorage !== "undefined" ? sessionStorage : null, TOKEN_KEY, legacy);
    return legacy;
  }
  return null;
}

export function setToken(token) {
  if (!token) return;
  safeSet(typeof sessionStorage !== "undefined" ? sessionStorage : null, TOKEN_KEY, token);
  // Clear the legacy localStorage so cross-tab leakage doesn't recur.
  safeRemove(typeof localStorage !== "undefined" ? localStorage : null, TOKEN_KEY);
}

export function clearToken() {
  safeRemove(typeof sessionStorage !== "undefined" ? sessionStorage : null, TOKEN_KEY);
  safeRemove(typeof localStorage !== "undefined" ? localStorage : null, TOKEN_KEY);
}
