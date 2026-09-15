import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ProjectForm } from "../project-form";
import { TemplatePicker } from "../template-picker";
import { createProject } from "@/lib/actions/projects";
import { listTeam } from "@/lib/data/common";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
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

  const [team, customerList] = await Promise.all([
    listTeam(),
    getDb()
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .orderBy(asc(customers.name)),
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
            <EmptyState
              title="Add a customer first"
              description="Projects belong to a customer, so there is always somewhere for the files, contacts and email history to live."
              action={
                <ButtonLink href="/customers/new" variant="primary">
                  Add a customer
                </ButtonLink>
              }
            />
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
      </PageBody>
    </>
  );
}
