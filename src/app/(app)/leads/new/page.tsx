import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { LeadForm } from "../lead-form";
import { createLead } from "@/lib/actions/leads";
import { listTeam } from "@/lib/data/common";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage() {
  await requireUser();
  const team = await listTeam();

  return (
    <>
      <PageHeader
        title="New lead"
        crumbs={[{ label: "Leads", href: "/leads" }, { label: "New" }]}
        description="Only the company name is required — everything else can be filled in as you learn it."
      />
      <PageBody className="max-w-3xl">
        <LeadForm
          action={createLead}
          team={team}
          submitLabel="Create lead"
          cancelHref="/leads"
        />
      </PageBody>
    </>
  );
}
