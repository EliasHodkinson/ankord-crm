import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { CustomerForm } from "../customer-form";
import { createCustomer } from "@/lib/actions/customers";
import { listTeam } from "@/lib/data/common";
import { requireUser } from "@/lib/auth/session";
import { requireStaffPage } from "@/lib/access";
import { isPartnerType } from "@/lib/contact-kinds";

export const metadata: Metadata = { title: "New Business Partner" };

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireUser();
  // Staff only — a restricted person has no way in, not just no link.
  await requireStaffPage();
  const team = await listTeam();
  // Opened from a tab, the form starts as that type.
  const { type } = await searchParams;
  const initialType = isPartnerType(type) ? type : "client";

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
          initialType={initialType}
          submitLabel="Create Business Partner"
          cancelHref={initialType === "client" ? "/customers" : `/customers?type=${initialType}`}
        />
      </PageBody>
    </>
  );
}
