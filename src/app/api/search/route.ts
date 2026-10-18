import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { searchEverything, type SearchHit } from "@/lib/data/search";

export const dynamic = "force-dynamic";

export type { SearchHit };

export async function GET(request: NextRequest) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  return NextResponse.json({ hits: await searchEverything(q) });
}
