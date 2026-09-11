/**
 * One place that turns the Clerk session into the bearer token every API
 * call carries.
 *
 * The API client used to rely on Clerk's `__session` cookie alone. That
 * cookie is short-lived (about a minute) and is only refreshed by Clerk's
 * script once it has loaded, so the first requests after a page load, or
 * after the tab sat idle, went out with an expired cookie and came back 401:
 * empty dashboards, "Unauthorized" toasts, checks that never ran. Asking
 * Clerk for a token per request (`getToken()` refreshes it when needed)
 * removes that window; requests made before Clerk has loaded wait for it.
 */
let getTokenImpl: (() => Promise<string | null>) | null = null;
let resolveReady: () => void = () => {};
const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

/** Called once Clerk reports `isLoaded`; safe to call again on re-render. */
export function setClerkTokenSource(getToken: (() => Promise<string | null>) | null): void {
  getTokenImpl = getToken;
  if (getToken) resolveReady();
}

/** The current session token, or null when signed out. Waits up to 4s for
 * Clerk to load so requests fired at mount are not sent unauthenticated. */
export async function apiToken(): Promise<string | null> {
  if (!getTokenImpl) {
    await Promise.race([ready, new Promise<void>((r) => setTimeout(r, 4000))]);
  }
  try {
    return getTokenImpl ? await getTokenImpl() : null;
  } catch {
    return null;
  }
}

/** Headers for hand-written fetch calls. */
export async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await apiToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}
