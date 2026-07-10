/**
 * Auth configuration flags.
 *
 * Clerk is optional: without keys the app serves read-only (all GETs are
 * public by design). DEV_AUTH_BYPASS=1 additionally signs every request in as
 * a local admin — for local development/preview only, and deliberately
 * impossible to combine with a real Clerk setup.
 */
export const clerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY,
);

export const devAuthBypass =
  !clerkConfigured && process.env.DEV_AUTH_BYPASS === "1";
