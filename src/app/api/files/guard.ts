import { NextResponse } from "next/server";
import { AccessDenied, assertFolder } from "@/lib/access";
import { describeGraphFailure } from "@/lib/graph/errors";

/**
 * The folder must belong to a record this person may see. Returns the error
 * response to send, or null to carry on.
 */
export async function guardFolder(driveId: string, itemId: string): Promise<NextResponse | null> {
  try {
    await assertFolder(driveId, itemId);
    return null;
  } catch (error) {
    if (error instanceof AccessDenied) {
      return NextResponse.json({ error: "You don't have access to that folder." }, { status: 403 });
    }
    return NextResponse.json({ error: describeGraphFailure(error) }, { status: 502 });
  }
}
