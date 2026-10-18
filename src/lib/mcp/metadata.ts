import "server-only";
import { MCP_SCOPE, issuerUrl, mcpUrl } from "./tokens";

/** RFC 9728: what the MCP endpoint is, and who issues tokens for it. */
export function protectedResourceMetadata() {
  return {
    resource: mcpUrl(),
    authorization_servers: [issuerUrl()],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "The Gangway",
    resource_documentation: `${issuerUrl()}/settings/connections`,
  };
}

/** RFC 8414: The Gangway's own authorization server, which signs people in with Microsoft. */
export function authorizationServerMetadata() {
  const base = issuerUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
      // Discovery documents are public; browser-based MCP clients read them too.
      "access-control-allow-origin": "*",
      ...init.headers,
    },
  });
}
