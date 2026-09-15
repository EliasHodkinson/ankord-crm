import "server-only";

/**
 * A thin Microsoft Graph client. Every call is made with the signed-in user's
 * delegated token, so the CRM can only ever see what that person can see in
 * Outlook and SharePoint.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }

  /** True when the fix is "ask an administrator to grant consent". */
  get isPermission() {
    return this.status === 403 || this.code === "Authorization_RequestDenied";
  }

  get isNotFound() {
    return this.status === 404;
  }
}

export async function graphFetch<T>(
  token: string,
  path: string,
  init: RequestInit & { rawBody?: BodyInit } = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.rawBody === undefined && init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(url, {
    ...init,
    body: init.rawBody ?? init.body,
    headers,
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText;
    try {
      const body = (await res.json()) as {
        error?: {
          code?: string;
          message?: string;
          innerError?: { message?: string; code?: string };
        };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;

      /**
       * Graph answers a malformed body with a bare "Invalid request" and puts
       * what was actually wrong in innerError. Without this the message names
       * the symptom and nothing else, which is useless when the request is
       * built in code and cannot be inspected by hand.
       */
      const inner = body.error?.innerError?.message ?? body.error?.innerError?.code;
      if (inner && inner !== message) message = `${message} (${inner})`;
    } catch {
      /* non-JSON error body */
    }
    throw new GraphError(res.status, code, message);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return (await res.arrayBuffer()) as T;
  return (await res.json()) as T;
}

/** Walks @odata.nextLink until `limit` items have been collected. */
export async function graphList<T>(
  token: string,
  path: string,
  limit = 200,
): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;

  while (next && items.length < limit) {
    const page: { value: T[]; "@odata.nextLink"?: string } = await graphFetch(token, next);
    items.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return items.slice(0, limit);
}

/* ── the signed-in user ──────────────────────────────────────────── */

export type GraphProfile = {
  id: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  mail?: string;
  userPrincipalName?: string;
  jobTitle?: string;
  mobilePhone?: string;
  officeLocation?: string;
};

export function fetchMyProfile(token: string): Promise<GraphProfile> {
  return graphFetch<GraphProfile>(
    token,
    "/me?$select=id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,mobilePhone,officeLocation",
  );
}

/** The 96px profile photo as a data URI, or null when the user has none. */
export async function fetchMyPhotoDataUri(token: string): Promise<string | null> {
  try {
    const buffer = await graphFetch<ArrayBuffer>(token, "/me/photos/96x96/$value");
    if (!buffer || buffer.byteLength === 0) return null;
    return `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
  } catch (error) {
    if (error instanceof GraphError && (error.isNotFound || error.status === 403)) return null;
    throw error;
  }
}
