/**
 * Mapping between Entra app roles and the CRM's own role names.
 *
 * Entra is the authority: whoever is assigned the app role in the tenant gets
 * that access here, and removing someone's assignment removes their access as a
 * side effect of ordinary offboarding. The `role` column on `users` is a cache
 * of the last claim seen, not a place to administer access.
 *
 * One exception: `restricted`, and the per-customer grants that go with it,
 * are administered in the CRM (Settings → People and access). A restriction set
 * there is never widened by a claim — see entraMayReplace.
 *
 * Lives outside the `"use server"` modules so the callback route, the settings
 * action and the team table can all import it.
 */

export type AppRole = "admin" | "member" | "viewer" | "restricted";

/** The `value` of each app role as defined on the Entra app registration. */
export const ENTRA_APP_ROLES = {
  "CRM.Admin": "admin",
  "CRM.Member": "member",
  "CRM.Viewer": "viewer",
  "CRM.Restricted": "restricted",
} as const satisfies Record<string, AppRole>;

/** Most privileged first — a person holding several roles gets the strongest. */
const PRECEDENCE: readonly AppRole[] = ["admin", "member", "viewer", "restricted"];

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

/**
 * Whether a role claimed by Entra may replace the role already on the record.
 *
 * A restriction set by an admin in the CRM is sticky: an Entra claim never
 * widens it. Otherwise a VA who happens to hold CRM.Member in the tenant (say,
 * from a group assignment) would silently see every customer at their next
 * sign-in. Narrowing is always allowed.
 */
export function entraMayReplace(
  current: { role: AppRole; roleSource: "entra" | "manual" },
  claimed: AppRole,
): boolean {
  if (current.role === "restricted" && current.roleSource === "manual") {
    return claimed === "restricted";
  }
  return true;
}
