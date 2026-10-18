import { handleMcp } from "@/lib/mcp/endpoint";

export const dynamic = "force-dynamic";
// Xero pushes and Planner syncs can take a while; give a tool call room.
export const maxDuration = 60;

/** The Gangway's MCP server. See lib/mcp and README § Connecting Claude. */
export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
