import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ProjectForm } from "../project-form";
import { TemplatePicker } from "../template-picker";
import { PlanImport } from "../plan-import";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { createProject } from "@/lib/actions/projects";
import { listTeam } from "@/lib/data/common";
import { listCustomerOptions } from "@/lib/data/customers";
import { getAccess } from "@/lib/access";
import { TEMPLATES, templateSize } from "@/lib/templates";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New project" };
export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  await requireUser();
  const { customer } = await searchParams;

  // Only the partners this person may see can own the new project.
  const [team, customerList, access] = await Promise.all([
    listTeam(),
    listCustomerOptions(),
    getAccess(),
  ]);

  if (customerList.length === 0) {
    return (
      <>
        <PageHeader
          title="New project"
          crumbs={[{ label: "Projects", href: "/projects" }, { label: "New" }]}
        />
        <PageBody>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            {access.restricted ? (
              <EmptyState
                title="Nothing has been shared with you yet"
                description="Projects belong to a business partner. Once an Ankor'd admin shares one with you, you can start projects for it here."
              />
            ) : (
              <EmptyState
                title="Add a business partner first"
                description="Projects belong to a business partner, so there is always somewhere for the files, contacts and email history to live."
                action={
                  <ButtonLink href="/customers/new" variant="primary">
                    Add a customer
                  </ButtonLink>
                }
              />
            )}
          </div>
        </PageBody>
      </>
    );
  }

  const options = TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    ...templateSize(t),
  }));

  return (
    <>
      <PageHeader
        title="New project"
        crumbs={[{ label: "Projects", href: "/projects" }, { label: "New" }]}
        description="Pick a template and the phases, steps and warnings are created ready to work through. You can add or change anything afterwards."
      />
      <PageBody className="max-w-4xl">
        <ProjectForm
          action={createProject}
          team={team}
          customers={customerList}
          defaultCustomerId={customer}
          submitLabel="Create project"
          cancelHref="/projects"
        >
          <TemplatePicker options={options} />
        </ProjectForm>

        <Card className="mt-6">
          <CardHeader
            title="Or start from a Microsoft Planner plan"
            meta="Its buckets become phases and its tasks become steps, and the two stay in sync"
          />
          <CardBody>
            <PlanImport customers={customerList} defaultCustomerId={customer} />
          </CardBody>
        </Card>
      </PageBody>
    </>
  );
}
