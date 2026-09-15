import { GraphAuthError } from "@/lib/auth/session";
import { GraphError } from "./client";

/** Turns a Graph failure into something a person can act on. */
export function describeGraphFailure(error: unknown): string {
  if (error instanceof GraphAuthError) {
    return `${error.message} Sign out and back in to reconnect Microsoft 365.`;
  }
  if (error instanceof GraphError) {
    if (error.isPermission) {
      return "Microsoft 365 refused that request. The app registration may still need admin consent for the permission this needs.";
    }
    if (error.isNotFound) {
      return "That item is no longer in Microsoft 365 — it may have been moved or deleted.";
    }
    return `Microsoft 365 said: ${error.message}`;
  }
  return error instanceof Error
    ? error.message
    : "Something went wrong talking to Microsoft 365.";
}
