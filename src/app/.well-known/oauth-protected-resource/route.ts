import { jsonResponse, protectedResourceMetadata } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

/** RFC 9728 at the root, for clients that look here before the path form. */
export function GET() {
  return jsonResponse(protectedResourceMetadata());
}
