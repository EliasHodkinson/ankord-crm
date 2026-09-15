import "server-only";
import { getGraphToken } from "@/lib/auth/session";
import { listChildren, listDrives, type DriveItem } from "@/lib/graph/sharepoint";
import { describeGraphFailure } from "@/lib/graph/errors";

/**
 * Reads a folder for the initial server render. A Graph failure is returned
 * rather than thrown, so a SharePoint outage never takes a record page down.
 */
export async function readFolder(
  driveId: string | null,
  itemId: string | null,
): Promise<{ items: DriveItem[]; error: string | null }> {
  if (!driveId || !itemId) return { items: [], error: null };
  try {
    return { items: await listChildren(await getGraphToken(), driveId, itemId), error: null };
  } catch (error) {
    return { items: [], error: describeGraphFailure(error) };
  }
}

/** Document libraries on a site, for the settings picker's first render. */
export async function readLibraries(siteId: string | null) {
  if (!siteId) return [];
  try {
    const drives = await listDrives(await getGraphToken(), siteId);
    return drives.filter((d) => d.driveType === "documentLibrary" || !d.driveType);
  } catch {
    return [];
  }
}
