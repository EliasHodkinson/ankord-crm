import { NextResponse, type NextRequest } from "next/server";
import { getGraphToken, getSession } from "@/lib/auth/session";
import { getSiteByUrl, listDrives, searchSites } from "@/lib/graph/sharepoint";
import { describeGraphFailure } from "@/lib/graph/errors";

export const dynamic = "force-dynamic";

/**
 * Powers the settings picker: `?site=` lists a site's libraries, `?url=`
 * resolves a pasted SharePoint address, and `?q=` searches by name.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const site = request.nextUrl.searchParams.get("site");
  const url = request.nextUrl.searchParams.get("url");
  const q = request.nextUrl.searchParams.get("q") ?? "";

  try {
    const token = await getGraphToken();
    if (site) {
      const drives = await listDrives(token, site);
      return NextResponse.json({
        drives: drives.filter((d) => d.driveType === "documentLibrary" || !d.driveType),
      });
    }
    if (url) {
      return NextResponse.json({ sites: [await getSiteByUrl(token, url)] });
    }
    return NextResponse.json({ sites: await searchSites(token, q) });
  } catch (error) {
    return NextResponse.json({ error: describeGraphFailure(error) }, { status: 502 });
  }
}
