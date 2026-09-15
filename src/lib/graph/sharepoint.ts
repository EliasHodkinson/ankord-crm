import "server-only";
import { GraphError, graphFetch, graphList } from "./client";

/**
 * SharePoint document-library access. The CRM never stores file content — it
 * creates and reads folders in the company library on the user's behalf and
 * keeps only the ids needed to find them again.
 */

export type DriveItem = {
  id: string;
  name: string;
  webUrl: string;
  size?: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
  lastModifiedBy?: { user?: { displayName?: string } };
  parentReference?: { driveId: string; id: string; path?: string };
};

export type SiteInfo = {
  id: string;
  name?: string;
  displayName?: string;
  webUrl: string;
};

export type DriveInfo = {
  id: string;
  name: string;
  webUrl: string;
  driveType?: string;
};

/** Every site the user can see, for the settings picker. */
export function searchSites(token: string, query: string): Promise<SiteInfo[]> {
  const q = query.trim();
  return graphList<SiteInfo>(
    token,
    `/sites?search=${encodeURIComponent(q || "*")}&$select=id,name,displayName,webUrl`,
    50,
  );
}

export function getSite(token: string, siteId: string): Promise<SiteInfo> {
  return graphFetch<SiteInfo>(token, `/sites/${siteId}?$select=id,name,displayName,webUrl`);
}

export function listDrives(token: string, siteId: string): Promise<DriveInfo[]> {
  return graphList<DriveInfo>(
    token,
    `/sites/${siteId}/drives?$select=id,name,webUrl,driveType`,
    25,
  );
}

export function getDrive(token: string, driveId: string): Promise<DriveInfo> {
  return graphFetch<DriveInfo>(token, `/drives/${driveId}?$select=id,name,webUrl,driveType`);
}

const ITEM_SELECT =
  "$select=id,name,webUrl,size,createdDateTime,lastModifiedDateTime,folder,file,lastModifiedBy,parentReference";

export async function listChildren(
  token: string,
  driveId: string,
  itemId: string,
): Promise<DriveItem[]> {
  // Graph will not order by the `folder` facet — it is a complex type — so the
  // folders-first grouping is applied here instead.
  const items = await graphList<DriveItem>(
    token,
    `/drives/${driveId}/items/${itemId}/children?${ITEM_SELECT}&$orderby=name&$top=200`,
    400,
  );

  return items.sort((a, b) => {
    const byKind = Number(Boolean(b.folder)) - Number(Boolean(a.folder));
    return byKind !== 0
      ? byKind
      : a.name.localeCompare(b.name, "en-AU", { sensitivity: "base", numeric: true });
  });
}

export function getItem(
  token: string,
  driveId: string,
  itemId: string,
): Promise<DriveItem> {
  return graphFetch<DriveItem>(token, `/drives/${driveId}/items/${itemId}?${ITEM_SELECT}`);
}

/**
 * Makes a name SharePoint will accept, changing as little as possible.
 * Only `" * : < > ? / \ |` are actually rejected — ampersands, hashes and
 * percent signs are fine in modern SharePoint, so a project called
 * "Onboarding & system migration" keeps its name.
 */
export function safeFolderName(name: string): string {
  return name
    .replace(/["*:<>?/\\|]/g, "-")
    .replace(/\s+/g, " ")
    // A leading tilde, and leading or trailing dots and spaces, are rejected.
    .replace(/^[~\s.]+|[\s.]+$/g, "")
    .slice(0, 120)
    .trim();
}

/**
 * Finds — or creates — a folder by path under the drive root, e.g.
 * `Clients/Maple Street Kitchens/Website rebuild`. Returns the folder item.
 */
export async function ensureFolderPath(
  token: string,
  driveId: string,
  segments: string[],
): Promise<DriveItem> {
  const clean = segments.map(safeFolderName).filter(Boolean);
  let parentId = "root";
  let current: DriveItem | null = null;

  for (const segment of clean) {
    current = await findChildByName(token, driveId, parentId, segment);
    current ??= await createFolder(token, driveId, parentId, segment);
    parentId = current.id;
  }

  return current ?? getItem(token, driveId, "root");
}

async function findChildByName(
  token: string,
  driveId: string,
  parentId: string,
  name: string,
): Promise<DriveItem | null> {
  try {
    const path = encodeURIComponent(name);
    return await graphFetch<DriveItem>(
      token,
      parentId === "root"
        ? `/drives/${driveId}/root:/${path}?${ITEM_SELECT}`
        : `/drives/${driveId}/items/${parentId}:/${path}?${ITEM_SELECT}`,
    );
  } catch (error) {
    if (error instanceof GraphError && error.isNotFound) return null;
    throw error;
  }
}

export function createFolder(
  token: string,
  driveId: string,
  parentId: string,
  name: string,
): Promise<DriveItem> {
  return graphFetch<DriveItem>(token, `/drives/${driveId}/items/${parentId}/children`, {
    method: "POST",
    body: JSON.stringify({
      name: safeFolderName(name),
      folder: {},
      // Keep both if someone else made a folder of the same name meanwhile.
      "@microsoft.graph.conflictBehavior": "rename",
    }),
  });
}

/**
 * Creates a set of folders directly inside a parent that is already known,
 * skipping any that are already there. Used for the client folder structure.
 *
 * One folder failing does not stop the others — a half-built structure the
 * caller can report on beats an exception that loses the folders that did work.
 */
export async function ensureChildFolders(
  token: string,
  driveId: string,
  parentId: string,
  names: string[],
): Promise<{ created: string[]; failed: string[] }> {
  const created: string[] = [];
  const failed: string[] = [];

  for (const raw of names) {
    const name = safeFolderName(raw);
    if (!name) continue;

    try {
      if (await findChildByName(token, driveId, parentId, name)) continue;
      await createFolder(token, driveId, parentId, name);
      created.push(name);
    } catch {
      failed.push(name);
    }
  }

  return { created, failed };
}

/** Simple upload — Graph accepts a single PUT up to 4 MB. */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

export async function uploadFile(
  token: string,
  driveId: string,
  parentId: string,
  file: File,
): Promise<DriveItem> {
  const name = safeFolderName(file.name) || "upload";

  if (file.size <= SIMPLE_UPLOAD_LIMIT) {
    return graphFetch<DriveItem>(
      token,
      `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`,
      {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        rawBody: await file.arrayBuffer(),
      },
    );
  }

  return uploadLargeFile(token, driveId, parentId, file, name);
}

/** Chunked upload session for anything above the simple-upload limit. */
async function uploadLargeFile(
  token: string,
  driveId: string,
  parentId: string,
  file: File,
  name: string,
): Promise<DriveItem> {
  const session = await graphFetch<{ uploadUrl: string }>(
    token,
    `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}:/createUploadSession`,
    {
      method: "POST",
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "rename", name },
      }),
    },
  );

  // Must be a multiple of 320 KiB; 5 MiB keeps the request count sane.
  const CHUNK = 5 * 320 * 1024;
  const buffer = await file.arrayBuffer();
  let uploaded: DriveItem | null = null;

  for (let start = 0; start < buffer.byteLength; start += CHUNK) {
    const end = Math.min(start + CHUNK, buffer.byteLength);
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "content-length": String(end - start),
        "content-range": `bytes ${start}-${end - 1}/${buffer.byteLength}`,
      },
      body: buffer.slice(start, end),
    });

    if (!res.ok && res.status !== 202) {
      throw new GraphError(res.status, "uploadFailed", `Upload failed at ${start} bytes.`);
    }
    if (res.status === 200 || res.status === 201) {
      uploaded = (await res.json()) as DriveItem;
    }
  }

  if (!uploaded) throw new GraphError(500, "uploadIncomplete", "Upload did not complete.");
  return uploaded;
}

export function deleteItem(token: string, driveId: string, itemId: string): Promise<void> {
  return graphFetch<void>(token, `/drives/${driveId}/items/${itemId}`, {
    method: "DELETE",
  });
}

/**
 * Resolves a SharePoint site from a browser URL, e.g.
 * `https://contoso.sharepoint.com/sites/TheAnkorage/Shared%20Documents/...`
 * Graph addresses sites as `{hostname}:/{server-relative-path}`, so anything
 * past the site segment is trimmed off first.
 */
export async function getSiteByUrl(token: string, input: string): Promise<SiteInfo> {
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  // /sites/Name and /teams/Name are the two site-collection prefixes.
  const prefixAt = segments.findIndex((s) => s === "sites" || s === "teams");
  const path = prefixAt === -1 ? "" : segments.slice(prefixAt, prefixAt + 2).join("/");

  const address = path ? `${url.hostname}:/${path}` : url.hostname;
  return graphFetch<SiteInfo>(
    token,
    `/sites/${address}?$select=id,name,displayName,webUrl`,
  );
}
