import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { RunbookBoard } from "@/components/app/runbook-board";
import { RunbookCalendar } from "@/components/app/runbook-calendar";
import { RunbookTimeline } from "@/components/app/runbook-timeline";
import { RUNBOOK_VIEW_OPTIONS, ViewToggle } from "@/components/app/view-toggle";
import { isRunbookView, type RunbookView } from "@/lib/runbook-views";
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
import { listCustomerOptions } from "@/lib/data/customers";
import { readFolder } from "@/lib/data/files";
import { updateProject } from "@/lib/actions/projects";
import { requireUser } from "@/lib/auth/session";
import { formatDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** The same steps, four ways — the subtitle says which question each answers. */
const RUNBOOK_META: Record<RunbookView, string> = {
  list: "Work through it in order — tick, assign, and leave notes as you go",
  board: "What is moving. Drag a card between columns to change its status",
  calendar: "What lands when. Click a step to open it in the runbook",
  timeline: "The shape of the job. Phase bars are first to last due date",
};

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ runbook?: string; month?: string; step?: string }>;
}) {
  const { user } = await requireUser();
  const { id } = await params;
  const { runbook, month } = await searchParams;
  const view: RunbookView = isRunbookView(runbook) ? runbook : "list";

  const project = await getProject(id);
  if (!project) notFound();

  const [entries, team, settings, folder, customerList] = await Promise.all([
    listCommunications({ projectId: id }),
    listTeam(),
    getSettings(),
    readFolder(project.spDriveId, project.spItemId),
    listCustomerOptions(),
  ]);

  const progress = progressOf(project.steps);

  /** The dated views need the whole page width; the ordered list does not. */
  const wide = view !== "list";

  const headlineBanner = project.headline ? (
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
  ) : null;

  const runbookCard = (
    <Card>
      <CardHeader
        title="Runbook"
        meta={RUNBOOK_META[view]}
        action={
          <ViewToggle
            views={RUNBOOK_VIEW_OPTIONS}
            param="runbook"
            defaultView="list"
            clears={["month", "step"]}
            label="Runbook view"
          />
        }
      />
      <CardBody>
        {view === "board" ? (
          <RunbookBoard project={project} />
        ) : view === "calendar" ? (
          <RunbookCalendar project={project} month={month} />
        ) : view === "timeline" ? (
          <RunbookTimeline project={project} />
        ) : (
          <Runbook project={project} team={team} />
        )}
      </CardBody>
    </Card>
  );

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
        {/*
         * The runbook list reads as a column and sits beside the contacts and
         * files rail. A month grid or a date axis does not — those take the
         * full width and push the rail below them.
         */}
        {wide ? (
          <>
            {headlineBanner ? (
              <div className="lg:col-span-2">{headlineBanner}</div>
            ) : null}
            <div className="lg:col-span-2">{runbookCard}</div>
          </>
        ) : null}

        <div className="flex flex-col gap-5">
          {wide ? null : headlineBanner}
          {wide ? null : runbookCard}

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
