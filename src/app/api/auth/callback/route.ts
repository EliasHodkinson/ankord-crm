import { NextResponse, type NextRequest } from "next/server";
import { count, eq, not, like, or } from "drizzle-orm";
import { exchangeCode } from "@/lib/auth/entra";
import { createSession, verifyIdToken } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { fetchMyPhotoDataUri, fetchMyProfile } from "@/lib/graph/client";
import { roleFromClaims } from "@/lib/roles";

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
    const tokens = await exchangeCode(code, verifier);
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

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.azureOid, claims.oid), eq(users.email, email)))
      .limit(1);

    if (existing) {
      await db
        .update(users)
        .set({
          azureOid: claims.oid,
          tenantId: claims.tid,
          email,
          name,
          jobTitle: profile?.jobTitle ?? null,
          ...(photo ? { photo } : {}),
          ...(entraRole ? { role: entraRole, roleSource: "entra" as const } : {}),
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));
      userId = existing.id;
    } else {
      // The first person through the door administers the CRM. Accounts made
      // by scripts/dev-session.ts do not count — they carry a synthetic oid.
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
          role: entraRole ?? (total === 0 ? "admin" : "member"),
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
  return response;
}
