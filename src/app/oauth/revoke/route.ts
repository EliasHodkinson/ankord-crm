import { revoke } from "@/lib/mcp/grants";

export const dynamic = "force-dynamic";

/**
 * RFC 7009 token revocation. A refresh token ends its whole connection; an
 * access token is short-lived and dies with the connection, so revoking one
 * alone is answered 200 like any unknown token.
 */
export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text().catch(() => ""));
  const token = form.get("token");
  if (token) await revoke(token);
  return new Response(null, { status: 200, headers: { "access-control-allow-origin": "*" } });
}
