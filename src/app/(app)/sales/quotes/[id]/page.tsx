import type { Metadata } from "next";
import { DocumentDetailPage } from "@/components/app/documents/document-detail";
import { DOC_TYPES } from "@/lib/sales/doc-types";

export const metadata: Metadata = { title: DOC_TYPES.quote.label };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  return <DocumentDetailPage type="quote" id={id} saved={saved} />;
}
