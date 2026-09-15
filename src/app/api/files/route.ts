import { NextResponse, type NextRequest } from "next/server";
import { getGraphToken, getSession } from "@/lib/auth/session";
import { listChildren } from "@/lib/graph/sharepoint";
import { describeGraphFailure } from "@/lib/graph/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const driveId = request.nextUrl.searchParams.get("driveId");
  const itemId = request.nextUrl.searchParams.get("itemId");
  if (!driveId || !itemId) {
    return NextResponse.json({ error: "Missing folder reference" }, { status: 400 });
  }

  try {
    const items = await listChildren(await getGraphToken(), driveId, itemId);
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: describeGraphFailure(error) }, { status: 502 });
  }
}
