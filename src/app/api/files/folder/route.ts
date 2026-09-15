import { NextResponse, type NextRequest } from "next/server";
import { getGraphToken, getSession } from "@/lib/auth/session";
import { createFolder } from "@/lib/graph/sharepoint";
import { describeGraphFailure } from "@/lib/graph/errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { driveId, itemId, name } = (await request.json()) as {
    driveId?: string;
    itemId?: string;
    name?: string;
  };

  if (!driveId || !itemId || !name?.trim()) {
    return NextResponse.json({ error: "A folder needs a name" }, { status: 400 });
  }

  try {
    const item = await createFolder(await getGraphToken(), driveId, itemId, name.trim());
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ error: describeGraphFailure(error) }, { status: 502 });
  }
}
