import type { Metadata } from "next";
import { DocumentFormPage } from "@/components/app/documents/document-form-page";
import { DOC_TYPES } from "@/lib/sales/doc-types";

export const metadata: Metadata = { title: `Edit ${DOC_TYPES.sales_order.label.toLowerCase()}` };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentFormPage type="sales_order" documentId={id} />;
}
