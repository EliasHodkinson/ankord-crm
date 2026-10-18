import { NextResponse, type NextRequest } from "next/server";
import { count, eq, not, like, or } from "drizzle-orm";
import { ACCESS_ADMIN_SCOPE_STRING, exchangeCode } from "@/lib/auth/entra";
import { createSession, verifyIdToken } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { fetchMyPhotoDataUri, fetchMyProfile } from "@/lib/graph/client";
import { entraMayReplace, roleFromClaims } from "@/lib/roles";

export const dynamic = "force-dynamic";

function failure(request: NextRequest, reason: string) {
  const url = new URL("/signin", request.nextUrl.origin);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  if (params.get("error")) {
    return failure(request, params.get("error_description") ?? params.get("error")!);
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = request.cookies.get("ankord_state")?.value;
  const verifier = request.cookies.get("ankord_pkce")?.value;
  const next = request.cookies.get("ankord_next")?.value ?? "/";

  if (!code || !verifier || !state || state !== expectedState) {
    return failure(request, "The sign-in link expired or was tampered with. Try again.");
  }

  let userId: string;
  try {
    const elevated = request.cookies.get("ankord_scopes")?.value === "access";
    const tokens = await exchangeCode(
      code,
      verifier,
      elevated ? ACCESS_ADMIN_SCOPE_STRING : undefined,
    );
    if (!tokens.id_token) return failure(request, "Microsoft did not return an identity token.");

    const claims = await verifyIdToken(tokens.id_token);
    const email = (claims.preferred_username ?? claims.email ?? "").toLowerCase();

    // Enrich from Graph; a failure here must not block sign-in.
    const [profile, photo] = await Promise.all([
      fetchMyProfile(tokens.access_token).catch(() => null),
      fetchMyPhotoDataUri(tokens.access_token).catch(() => null),
    ]);

    const db = getDb();
    const name = profile?.displayName ?? claims.name ?? email;

    // Match on the Entra object id first; fall back to the address so a row
    // created before this person's first sign-in is adopted rather than
    // colliding with the unique email index.
    // Entra owns the role once app roles exist on the registration. A token
    // with no roles claim yields null, which leaves whatever role is already on
    // the record alone rather than downgrading anyone — so this is safe to ship
    // before the roles are configured in the tenant.
    const entraRole = roleFromClaims(claims.roles);

    // A B2B guest — a VA, a contractor — is not Ankor'd staff. Graph says so
    // directly; the id_token says so when the identity provider is not this
    // tenant; and a guest's UPN carries #EXT#. Any one is enough.
    const isGuest =
      profile?.userType === "Guest" ||
      Boolean(claims.idp && claims.idp !== claims.iss) ||
      (profile?.userPrincipalName ?? "").includes("#EXT#");

    const [existing] = await db
      .select({ id: users.id, role: users.role, roleSource: users.roleSource })
      .from(users)
      .where(or(eq(users.azureOid, claims.oid), eq(users.email, email)))
      .limit(1);

    if (existing) {
      const takeEntraRole = entraRole !== null && entraMayReplace(existing, entraRole);
      await db
        .update(users)
        .set({
          azureOid: claims.oid,
          tenantId: claims.tid,
          email,
          name,
          jobTitle: profile?.jobTitle ?? null,
          ...(photo ? { photo } : {}),
          ...(takeEntraRole ? { role: entraRole, roleSource: "entra" as const } : {}),
          ...(isGuest ? { isGuest: true } : {}),
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));
      userId = existing.id;
    } else {
      // The first person through the door administers the CRM. Accounts made
      // by scripts/dev-session.ts do not count — they carry a synthetic oid.
      //
      // A guest nobody added in Settings starts restricted with no grants, so
      // they see an empty CRM rather than every customer: being a guest in the
      // tenant (for a Teams channel, a shared file) is not a reason to see the
      // book. An admin grants them what they need.
      const [{ total }] = await db
        .select({ total: count() })
        .from(users)
        .where(not(like(users.azureOid, "dev-%")));
      const [created] = await db
        .insert(users)
        .values({
          azureOid: claims.oid,
          tenantId: claims.tid,
          email,
          name,
          jobTitle: profile?.jobTitle ?? null,
          photo,
          isGuest,
          role: entraRole ?? (isGuest ? "restricted" : total === 0 ? "admin" : "member"),
          roleSource: entraRole ? "entra" : "manual",
          lastSeenAt: new Date(),
        })
        .returning({ id: users.id });
      userId = created.id;
    }

    await createSession(userId, tokens);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sign-in failed for an unknown reason.";
    return failure(request, message);
  }

  const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));
  response.cookies.delete("ankord_pkce");
  response.cookies.delete("ankord_state");
  response.cookies.delete("ankord_next");
  response.cookies.delete("ankord_scopes");
  return response;
}
