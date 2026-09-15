import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FilterBar } from "@/components/app/filter-bar";
import { QuickTask } from "@/components/app/quick-task";
import { TaskList, type TaskItem } from "@/components/app/task-list";
import { listTasks } from "@/lib/data/tasks";
import { listTeam } from "@/lib/data/common";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; show?: string }>;
}) {
  const { user } = await requireUser();
  const { who, show } = await searchParams;
  const includeDone = show === "all";

  const [rows, team] = await Promise.all([
    listTasks({
      assigneeId: who === "everyone" ? "everyone" : user.id,
      includeDone,
    }),
    listTeam(),
  ]);

  const items: TaskItem[] = rows.map((r) => ({
    id: r.task.id,
    title: r.task.title,
    detail: r.task.detail,
    status: r.task.status,
    priority: r.task.priority,
    dueDate: r.task.dueDate,
    assigneeName: r.assigneeName,
    assigneePhoto: r.assigneePhoto,
    customerId: r.task.customerId,
    customerName: r.customerName,
    projectId: r.task.projectId,
    projectName: r.projectName,
    leadId: r.task.leadId,
    leadName: r.leadName,
  }));

  const open = items.filter((t) => t.status === "open").length;

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Everything you said you would do. Set one from any lead, customer or project and it turns up here on the day."
        meta={
          <p className="text-[13px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text)]">{open}</span> open
          </p>
        }
      />

      <PageBody className="flex max-w-3xl flex-col gap-4">
        <FilterBar
          searchPlaceholder="Search follow-ups…"
          filters={[
            {
              param: "who",
              label: "Who",
              defaultValue: "me",
              options: [
                { value: "me", label: "Mine" },
                { value: "everyone", label: "Everyone" },
              ],
            },
            {
              param: "show",
              label: "Show",
              defaultValue: "open",
              options: [
                { value: "open", label: "Open only" },
                { value: "all", label: "Include done" },
              ],
            },
          ]}
        />

        <Card>
          <CardHeader title="Add a follow-up" meta="Anything that is not attached to a record yet" />
          <CardBody>
            <QuickTask
              revalidate="/tasks"
              team={team}
              placeholder="Ring the incumbent provider about the GA handover…"
            />
          </CardBody>
        </Card>

        <TaskList
          tasks={items}
          revalidate="/tasks"
          showOwner={who === "everyone"}
          emptyTitle={who === "everyone" ? "The team is clear" : "You're all clear"}
          emptyDescription="Set a follow-up from a lead, a customer or a project and it will show up here, grouped by when it's due."
        />
      </PageBody>
    </>
  );
}
