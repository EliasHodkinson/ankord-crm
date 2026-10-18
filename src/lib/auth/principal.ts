import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who a request acts as when it did not arrive with the session cookie.
 *
 * The MCP endpoint verifies a bearer token, then runs the tool inside
 * `actAs()`. From there every existing read and action works unchanged:
 * `getSession()` finds the MCP session instead of a cookie, so `requireUser`,
 * `getAccess`, the `assert*` checks and `getGraphToken` all apply to that
 * person exactly as they do in the browser. Nothing here widens access — an
 * MCP session is a session of that person, with their role and their grants.
 */

export type Principal = {
  sessionId: string;
  via: "mcp";
  /** The connected client's name, for the activity log. */
  client: string;
  /** Activity rows written during this call, so the MCP layer knows whether to add one. */
  activityLogged: number;
};

const store = new AsyncLocalStorage<Principal>();

export function currentPrincipal(): Principal | null {
  return store.getStore() ?? null;
}

export function actAs<T>(principal: Principal, run: () => T): T {
  return store.run(principal, run);
}
