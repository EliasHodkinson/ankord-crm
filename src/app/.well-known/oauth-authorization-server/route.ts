import { authorizationServerMetadata, jsonResponse } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

export function GET() {
  return jsonResponse(authorizationServerMetadata());
}
