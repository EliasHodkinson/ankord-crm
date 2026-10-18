import { jsonResponse, protectedResourceMetadata } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

/** RFC 9728 for the `/mcp` resource — the URL the 401 challenge names. */
export function GET() {
  return jsonResponse(protectedResourceMetadata());
}
