import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getDocument } from "@/lib/data/documents";
import { DOC_TYPES, typeLabel } from "@/lib/sales/doc-types";
import { XeroAuthError } from "@/lib/xero/auth";
import { XeroApiError, xeroPdf } from "@/lib/xero/client";

export const dynamic = "force-dynamic";

/**
 * Streams Xero's own PDF of a document. The Gangway renders no customer
 * documents itself (D2): what the customer receives is what Xero renders.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;

  // Null for a document whose partner this person may not see.
  const detail = await getDocument(id);
  const resource = detail ? DOC_TYPES[detail.doc.type].xero : null;
  if (!detail || !resource || !detail.doc.xeroId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const pdf = await xeroPdf(resource, detail.doc.xeroId);
    const name = `${typeLabel(detail.doc.type, detail.doc.isReserve)} ${detail.doc.number ?? id.slice(0, 8)}.pdf`;
    return new NextResponse(pdf, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${name.replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof XeroAuthError || error instanceof XeroApiError
        ? error.message
        : "Could not fetch the PDF from Xero.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
