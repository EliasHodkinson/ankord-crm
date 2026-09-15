import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { CustomerForm } from "../customer-form";
import { createCustomer } from "@/lib/actions/customers";
import { listTeam } from "@/lib/data/common";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New Business Partner" };

export default async function NewCustomerPage() {
  await requireUser();
  const team = await listTeam();

  return (
    <>
      <PageHeader
        title="New Business Partner"
        crumbs={[{ label: "Business Partners", href: "/customers" }, { label: "New" }]}
        description="Add the business first — you can add its people, projects and files straight after."
      />
      <PageBody className="max-w-3xl">
        <CustomerForm
          action={createCustomer}
          team={team}
          submitLabel="Create Business Partner"
          cancelHref="/customers"
        />
      </PageBody>
    </>
  );
}
