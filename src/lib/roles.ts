/**
 * Mapping between Entra app roles and the CRM's own role names.
 *
 * Entra is the authority: whoever is assigned the app role in the tenant gets
 * that access here, and removing someone's assignment removes their access as a
 * side effect of ordinary offboarding. The `role` column on `users` is a cache
 * of the last claim seen, not a place to administer access.
 *
 * Lives outside the `"use server"` modules so the callback route, the settings
 * action and the team table can all import it.
 */

export type AppRole = "admin" | "member" | "viewer";

/** The `value` of each app role as defined on the Entra app registration. */
export const ENTRA_APP_ROLES = {
  "CRM.Admin": "admin",
  "CRM.Member": "member",
  "CRM.Viewer": "viewer",
} as const satisfies Record<string, AppRole>;

/** Most privileged first — a person holding several roles gets the strongest. */
const PRECEDENCE: readonly AppRole[] = ["admin", "member", "viewer"];

/**
 * The role Entra claims for this sign-in, or `null` when the token carries no
 * usable `roles` claim.
 *
 * Null is deliberately different from "no access". It means app roles are not
 * configured yet, or this person holds none of them — in which case the role
 * already on the record is left alone rather than silently downgraded. That is
 * what makes it safe to deploy this before the roles exist in Entra: nothing
 * changes until the claim starts arriving.
 */
export function roleFromClaims(roles: unknown): AppRole | null {
  if (!Array.isArray(roles)) return null;

  const mapped = roles
    .filter((value): value is string => typeof value === "string")
    .map((value) => ENTRA_APP_ROLES[value as keyof typeof ENTRA_APP_ROLES])
    .filter((role): role is AppRole => Boolean(role));

  if (mapped.length === 0) return null;
  return PRECEDENCE.find((role) => mapped.includes(role)) ?? null;
}
