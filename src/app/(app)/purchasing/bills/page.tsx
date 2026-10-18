import type { Metadata } from "next";
import { DocumentList } from "@/components/app/documents/document-list";
import type { DocumentFilters } from "@/lib/data/documents";
import { DOC_TYPES } from "@/lib/sales/doc-types";

export const metadata: Metadata = { title: DOC_TYPES.bill.plural };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<DocumentFilters> }) {
  return <DocumentList type="bill" filters={await searchParams} />;
}
