import type { Metadata } from "next";
import { DocumentFormPage } from "@/components/app/documents/document-form-page";
import { DOC_TYPES } from "@/lib/sales/doc-types";

export const metadata: Metadata = { title: `New ${DOC_TYPES.quote.label.toLowerCase()}` };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; partner?: string; reserve?: string }>;
}) {
  const { from, partner, reserve } = await searchParams;
  return <DocumentFormPage type="quote" from={from} partnerId={partner} reserve={reserve === "1"} />;
}
