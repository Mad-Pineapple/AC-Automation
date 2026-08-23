/**
 * Resolve a Clerk bearer token without ever blocking the UI: when Clerk
 * isn't available (local bypass builds, blocked script) `getToken` may never
 * settle, so race it against a short timeout and fall back to cookies.
 */
export async function tokenOrNull(getToken: () => Promise<string | null>, ms = 1500): Promise<string | null> {
  try {
    return await Promise.race<string | null>([
      getToken().catch(() => null),
      new Promise<string | null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  } catch {
    return null;
  }
}
