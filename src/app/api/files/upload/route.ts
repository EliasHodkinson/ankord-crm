import { NextResponse, type NextRequest } from "next/server";
import { getGraphToken, getSession } from "@/lib/auth/session";
import { uploadFile } from "@/lib/graph/sharepoint";
import { describeGraphFailure } from "@/lib/graph/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const form = await request.formData();
  const driveId = String(form.get("driveId") ?? "");
  const itemId = String(form.get("itemId") ?? "");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!driveId || !itemId) {
    return NextResponse.json({ error: "Missing folder reference" }, { status: 400 });
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "Nothing was attached" }, { status: 400 });
  }

  try {
    const token = await getGraphToken();
    const uploaded = [];
    for (const file of files) {
      uploaded.push(await uploadFile(token, driveId, itemId, file));
    }
    return NextResponse.json({ items: uploaded });
  } catch (error) {
    return NextResponse.json({ error: describeGraphFailure(error) }, { status: 502 });
  }
}
