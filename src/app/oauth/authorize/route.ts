import { NextResponse, type NextRequest } from "next/server";
import { ClientError, resolveClient } from "@/lib/mcp/clients";
import { REQUEST_COOKIE, SESSION_COOKIE, cookieOptions, sealRequest } from "@/lib/mcp/grants";
import { PKCE_CHALLENGE, redirectUriMatches, resourceAllowed, withParams } from "@/lib/mcp/oauth-rules";
import { issuerUrl, mcpUrl } from "@/lib/mcp/tokens";
import { isAuthConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The OAuth authorization endpoint for MCP clients. Nothing is granted here:
 * it checks the request, keeps it in a signed cookie, and sends the person
 * through the ordinary Microsoft sign-in. /oauth/consent picks it up after.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = request.nextUrl.origin;

  // Until the client and its redirect URI check out, nothing is sent back to
  // it — an unchecked redirect_uri is an open redirect.
  const showError = (message: string) => {
    const url = new URL("/oauth/consent", origin);
    url.searchParams.set("error", message);
    return NextResponse.redirect(url);
  };

  if (!isAuthConfigured()) return showError("The Gangway is not set up for sign-in yet.");

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  let client;
  try {
    client = await resolveClient(clientId);
  } catch (error) {
    if (error instanceof ClientError) return showError(error.message);
    throw error;
  }
  if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
    return showError(`${client.name} asked to return to an address it has not registered.`);
  }

  const state = params.get("state");
  const bounce = (error: string, description: string) =>
    NextResponse.redirect(
      withParams(redirectUri, {
        error,
        error_description: description,
        state: state ?? undefined,
        iss: issuerUrl(),
      }),
    );

  if (params.get("response_type") !== "code") {
    return bounce("unsupported_response_type", "Only the authorization code flow is supported.");
  }
  const codeChallenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !PKCE_CHALLENGE.test(codeChallenge)) {
    return bounce("invalid_request", "PKCE with S256 is required.");
  }
  const resource = params.get("resource");
  if (!resourceAllowed(resource, mcpUrl())) {
    return bounce("invalid_target", "This server only issues tokens for its own MCP endpoint.");
  }

  const response = NextResponse.redirect(
    new URL(`/api/auth/signin?purpose=mcp&next=${encodeURIComponent("/oauth/consent")}`, origin),
  );
  response.cookies.set(
    REQUEST_COOKIE,
    await sealRequest({
      client: client.id,
      redirectUri,
      state,
      codeChallenge,
      resource: resource ?? mcpUrl(),
    }),
    cookieOptions,
  );
  // A half-finished earlier attempt must not be approved in this one's name.
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
