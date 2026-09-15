import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { Mail, Megaphone } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { DataRow } from "@/components/ui/field";
import { ProgressBar } from "@/components/ui/progress";
import {
  PRIORITY,
  PROJECT_HEALTH,
  PROJECT_STATUS,
  StatusBadge,
} from "@/components/ui/status";
import { Runbook } from "@/components/app/runbook";
import { KeyContacts } from "@/components/app/key-contacts";
import { AccountRegister } from "@/components/app/account-register";
import { Timeline } from "@/components/app/timeline";
import { LogCommunication } from "@/components/app/log-communication";
import { RecordTasks } from "@/components/app/record-tasks";
import { TrackVisit } from "@/components/app/track-visit";
import { FilesPanel } from "@/components/app/files-panel";
import { ConnectFolder } from "@/components/app/connect-folder";
import { ProjectForm } from "../project-form";
import { getProject, progressOf } from "@/lib/data/projects";
import { listCommunications } from "@/lib/data/communications";
import { getSettings, listTeam } from "@/lib/data/common";
import { readFolder } from "@/lib/data/files";
import { updateProject } from "@/lib/actions/projects";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { formatDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await getProject(id).catch(() => null);
  return { title: project?.name ?? "Project" };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireUser();
  const { id } = await params;

  const project = await getProject(id);
  if (!project) notFound();

  const [entries, team, settings, folder, customerList] = await Promise.all([
    listCommunications({ projectId: id }),
    listTeam(),
    getSettings(),
    readFolder(project.spDriveId, project.spItemId),
    getDb()
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .orderBy(asc(customers.name)),
  ]);

  const progress = progressOf(project.steps);

  return (
    <>
      <TrackVisit
        href={`/projects/${project.id}`}
        label={project.name}
        kind="project"
      />
      <PageHeader
        title={project.name}
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.customer.name, href: `/customers/${project.customer.id}` },
          { label: project.name },
        ]}
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge map={PROJECT_STATUS} value={project.status} />
            {project.status === "active" ? (
              <StatusBadge map={PROJECT_HEALTH} value={project.health} dot />
            ) : null}
            {project.priority !== "normal" ? (
              <StatusBadge map={PRIORITY} value={project.priority} />
            ) : null}
          </span>
        }
        description={project.summary}
        meta={
          <div className="flex max-w-md items-center gap-3">
            <ProgressBar
              done={progress.done}
              total={progress.total}
              blocked={progress.blocked}
              showLabel={false}
              className="max-w-56"
            />
            <span className="text-[13px] text-[var(--text-muted)] tabular">
              {progress.done} of {progress.total} steps
              {progress.blocked > 0 ? (
                <span className="text-[var(--danger)]">
                  {" "}
                  · {progress.blocked} blocked
                </span>
              ) : null}
            </span>
          </div>
        }
        actions={
          <ButtonLink href={`/inbox?project=${project.id}`} variant="secondary">
            <Mail />
            Link email
          </ButtonLink>
        }
      />

      <PageBody className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex flex-col gap-5">
          {project.headline ? (
            <div className="rounded-[10px] border border-[var(--color-sunrise-300)] bg-[var(--color-sunrise-50)] p-4 dark:border-[var(--color-sunrise-700)] dark:bg-[var(--color-sunrise-900)]/30">
              <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.04em] text-[var(--color-sunrise-700)] uppercase dark:text-[var(--color-sunrise-300)]">
                <Megaphone className="size-3.5" />
                Act first
              </p>
              <p className="mt-1.5 text-[16px] leading-6 font-semibold text-[var(--text)]">
                {project.headline}
              </p>
              {project.headlineDetail ? (
                <p className="mt-1.5 max-w-[70ch] text-[13px] leading-6 text-[var(--text-muted)]">
                  {project.headlineDetail}
                </p>
              ) : null}
            </div>
          ) : null}

          <Card>
            <CardHeader
              title="Runbook"
              meta="Work through it in order — tick, assign, and leave notes as you go"
            />
            <CardBody>
              <Runbook project={project} team={team} />
            </CardBody>
          </Card>

          <RecordTasks
            scope={{ projectId: project.id, customerId: project.customerId }}
            revalidate={`/projects/${project.id}`}
            placeholder="Chase the DNS auth code…"
          />

          <Card>
            <CardHeader
              title="Account register"
              meta="Every system this project touches, and where its credential lives"
            />
            <CardBody>
              <AccountRegister
                accounts={project.accounts}
                projectId={project.id}
                customerId={project.customerId}
                revalidate={`/projects/${project.id}`}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Communications"
              meta={`${entries.length} on this project`}
            />
            <CardBody className="flex flex-col gap-4">
              <LogCommunication
                customerId={project.customerId}
                projectId={project.id}
                contactOptions={project.customer.contacts.map((c) => ({
                  id: c.id,
                  label: `${c.firstName} ${c.lastName ?? ""}`.trim(),
                }))}
                redirectTo={`/projects/${project.id}`}
              />
              <Timeline
                entries={entries}
                currentUserId={user.id}
                canModerate={user.role === "admin"}
                revalidate={`/projects/${project.id}`}
              />
            </CardBody>
          </Card>

          {project.stateBefore || project.stateAfter ? (
            <Card>
              <CardHeader
                title="Systems map"
                meta="How it works today, and how it should work after"
              />
              <CardBody className="grid gap-5 sm:grid-cols-2">
                <div>
                  <h3 className="text-[12px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase">
                    Today
                  </h3>
                  <p className="mt-2 text-[13px] leading-6 whitespace-pre-line text-[var(--text)]">
                    {project.stateBefore ?? "—"}
                  </p>
                </div>
                <div className="sm:border-l sm:border-[var(--border-soft)] sm:pl-5">
                  <h3 className="text-[12px] font-semibold tracking-[0.04em] text-[var(--color-coastal-600)] uppercase">
                    After
                  </h3>
                  <p className="mt-2 text-[13px] leading-6 whitespace-pre-line text-[var(--text)]">
                    {project.stateAfter ?? "—"}
                  </p>
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Project details" />
            <CardBody>
              <ProjectForm
                action={updateProject.bind(null, project.id)}
                project={project}
                team={team}
                customers={customerList}
                submitLabel="Save changes"
                cancelHref={`/projects/${project.id}`}
              />
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Key contacts" meta="Who this depends on" />
            <CardBody>
              <KeyContacts projectId={project.id} contacts={project.keyContacts} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Files" meta="Stored in SharePoint" />
            <CardBody>
              {project.spDriveId && project.spItemId ? (
                <FilesPanel
                  driveId={project.spDriveId}
                  rootItemId={project.spItemId}
                  rootName={project.name}
                  webUrl={project.spWebUrl}
                  initialItems={folder.items}
                  initialError={folder.error}
                />
              ) : (
                <ConnectFolder
                  scope={{ projectId: project.id }}
                  libraryReady={Boolean(settings?.spDriveId)}
                  canConfigure={user.role === "admin"}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="divide-y divide-[var(--border-soft)]">
                <DataRow label="Business partner">
                  <Link
                    href={`/customers/${project.customer.id}`}
                    className="text-[var(--color-coastal-600)] hover:underline underline-offset-2"
                  >
                    {project.customer.name}
                  </Link>
                </DataRow>
                <DataRow label="Lead">
                  {project.owner ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar name={project.owner.name} src={project.owner.photo} size="xs" />
                      {project.owner.name}
                    </span>
                  ) : (
                    <span className="text-[var(--text-faint)]">Unassigned</span>
                  )}
                </DataRow>
                <DataRow label="Reference">
                  <span className="font-mono text-[12px]">{project.code ?? "—"}</span>
                </DataRow>
                <DataRow label="Started">{formatDate(project.startDate)}</DataRow>
                <DataRow label="Target">{formatDate(project.targetDate)}</DataRow>
                <DataRow label="Budget">{money(project.budgetAud)}</DataRow>
              </dl>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
