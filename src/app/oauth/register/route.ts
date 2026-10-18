import { ClientError, registerClient } from "@/lib/mcp/clients";
import { jsonResponse } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

/** RFC 7591 Dynamic Client Registration, for MCP clients that predate metadata documents. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_client_metadata", error_description: "Send the client metadata as JSON." },
      { status: 400 },
    );
  }
  try {
    const client = await registerClient(body);
    return jsonResponse(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.name,
        ...(client.clientUri ? { client_uri: client.clientUri } : {}),
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ClientError) {
      return jsonResponse({ error: error.code, error_description: error.message }, { status: 400 });
    }
    throw error;
  }
}

export function OPTIONS() {
  return corsPreflight();
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
