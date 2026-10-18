import "server-only";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { AccessDenied } from "@/lib/access";
import { GraphAuthError, ReadOnlyError } from "@/lib/auth/session";
import { currentPrincipal } from "@/lib/auth/principal";
import { logActivity, type ActionState } from "@/lib/actions/shared";
import { toWallTime } from "@/lib/utils";

/**
 * How a tool call turns into an MCP result. Tools call the same data reads
 * and server actions as the pages; this maps what those do — return an
 * ActionState, throw AccessDenied, call notFound() or redirect() — into a
 * result the model can read.
 */

/** A refusal worded for the person, returned as a tool error. */
export class ToolFailure extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ToolFailure";
  }
}

const NO_ACCESS =
  "Not found, or you don't have access to it. (The Gangway does not say which, on purpose.)";

/** Next's control-flow errors carry a digest instead of a class. */
function digestOf(error: unknown): string | null {
  return typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string"
    ? error.digest
    : null;
}

/** Where a server action's redirect() was sending the browser, if it did. */
function redirectTarget(error: unknown): string | null {
  const digest = digestOf(error);
  if (!digest?.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";")[2] ?? null;
}

/**
 * Calls a server action that redirects on success (create forms land on the
 * new record). The redirect is the success: its path, and any `?saved=`
 * message, come back as data. A redirect to sign-in or a denial is not.
 */
export async function settle(run: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await run()) ?? { ok: true };
  } catch (error) {
    const target = redirectTarget(error);
    if (!target || target.startsWith("/signin") || target.includes("denied=")) throw error;
    const url = new URL(target, "http://local");
    return {
      ok: true,
      message: url.searchParams.get("saved") ?? undefined,
      data: { href: url.pathname },
    };
  }
}

/** An ActionState that failed becomes a tool error; one that succeeded passes through. */
export function expectOk(state: ActionState): ActionState {
  if (!state.ok) throw new ToolFailure(state.message ?? "That didn't work.", state.fieldErrors);
  return state;
}

/* ── results ─────────────────────────────────────────────────────── */

/** An instant as Sydney wall time with its offset, e.g. 2026-10-18T17:00+11:00. */
export function sydneyTime(d: Date): string {
  const wall = toWallTime(d);
  const offset = Math.round((Date.parse(`${wall}:00Z`) - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${wall}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Fields never worth sending to a model: base64 photos, and anything token-shaped. */
const DROP = /photo$|Enc$|^refreshHash$|^spDriveId$|^spItemId$/i;

function clean(value: unknown): unknown {
  if (value instanceof Date) return sydneyTime(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (DROP.test(key) || v === undefined) continue;
      out[key] = clean(v);
    }
    return out;
  }
  return value;
}

function text(value: unknown): CallToolResult {
  const body = typeof value === "string" ? value : JSON.stringify(clean(value), null, 1);
  return { content: [{ type: "text", text: body }] };
}

function failure(message: string, extra?: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: extra ? `${message}\n${JSON.stringify(extra)}` : message }],
  };
}

function asFailure(error: unknown): CallToolResult {
  if (error instanceof ToolFailure) {
    return failure(error.message, error.fieldErrors ? { fieldErrors: error.fieldErrors } : undefined);
  }
  if (error instanceof AccessDenied) {
    return failure(error.message === "You don't have access to that." ? NO_ACCESS : error.message);
  }
  if (error instanceof ReadOnlyError) return failure(`${error.message} (Your role is read-only for this.)`);
  if (error instanceof GraphAuthError) {
    return failure(`${error.message} Reconnect The Gangway in your MCP client to sign in again.`);
  }
  const digest = digestOf(error);
  if (digest?.startsWith("NEXT_HTTP_ERROR_FALLBACK") || redirectTarget(error)) return failure(NO_ACCESS);
  console.error("[mcp] tool failed", error);
  return failure(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
}

/* ── running tools ───────────────────────────────────────────────── */

export async function read(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await run();
    if (value === null || value === undefined) return failure(NO_ACCESS);
    return text(value);
  } catch (error) {
    return asFailure(error);
  }
}

/** What a write is recorded against in the activity feed. */
export type AuditEntry = {
  entityType: string;
  entityId: string;
  summary: string;
  customerId?: string | null;
  projectId?: string | null;
  leadId?: string | null;
};

/**
 * Runs a write. Every write made through MCP lands in the activity log as the
 * person, marked `via: "mcp"` (logActivity adds that). Most actions log for
 * themselves; for the ones that don't (a step's status, a follow-up ticked
 * off), the entry the tool describes is written here instead.
 */
export async function write(
  tool: string,
  run: () => Promise<{ result: unknown; audit: AuditEntry | null }>,
): Promise<CallToolResult> {
  const principal = currentPrincipal();
  const before = principal?.activityLogged ?? 0;
  try {
    const { result, audit } = await run();
    if (audit && principal && principal.activityLogged === before) {
      await logActivity({ ...audit, verb: `mcp_${tool}` });
    }
    return text(result);
  } catch (error) {
    return asFailure(error);
  }
}
