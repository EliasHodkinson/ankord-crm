import { GrantError, exchangeCode, refresh } from "@/lib/mcp/grants";
import { jsonResponse } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

/** The OAuth token endpoint: authorization_code (with PKCE) and refresh_token. Public clients only. */
export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthError("invalid_request", "Send the request as application/x-www-form-urlencoded.");
  }
  const clientId = form.get("client_id") ?? "";
  const resource = form.get("resource");

  try {
    switch (form.get("grant_type")) {
      case "authorization_code": {
        const code = form.get("code");
        const redirectUri = form.get("redirect_uri");
        const verifier = form.get("code_verifier");
        if (!code || !redirectUri || !verifier || !clientId) {
          return oauthError("invalid_request", "code, redirect_uri, code_verifier and client_id are required.");
        }
        return jsonResponse(
          await exchangeCode({ clientId, code, redirectUri, codeVerifier: verifier, resource }),
          { headers: { pragma: "no-cache" } },
        );
      }
      case "refresh_token": {
        const token = form.get("refresh_token");
        if (!token || !clientId) return oauthError("invalid_request", "refresh_token and client_id are required.");
        return jsonResponse(await refresh({ clientId, refreshToken: token, resource }), {
          headers: { pragma: "no-cache" },
        });
      }
      default:
        return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
    }
  } catch (error) {
    if (error instanceof GrantError) return oauthError(error.code, error.message);
    throw error;
  }
}

function oauthError(error: string, description: string) {
  return jsonResponse({ error, error_description: description }, { status: 400 });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
