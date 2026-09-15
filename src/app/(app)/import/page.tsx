import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Importer } from "./importer";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireUser();

  return (
    <>
      <PageHeader
        title="Import"
        description="Bring business partners or leads across from a spreadsheet or another CRM. Nothing is saved until you have seen exactly what will be created."
      />
      <PageBody className="max-w-4xl">
        <Importer />
      </PageBody>
    </>
  );
}
