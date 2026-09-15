import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { QuickTask } from "./quick-task";
import { TaskList, type TaskItem } from "./task-list";
import { listTasks } from "@/lib/data/tasks";
import { listTeam } from "@/lib/data/common";

/** The follow-up panel that sits on every record page. */
export async function RecordTasks({
  scope,
  revalidate,
  placeholder,
}: {
  scope: { customerId?: string; projectId?: string; leadId?: string };
  revalidate: string;
  placeholder?: string;
}) {
  const [rows, team] = await Promise.all([
    // Everyone's follow-ups against this record, not only the reader's.
    listTasks({ ...scope, assigneeId: "everyone", limit: 30 }),
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

  return (
    <Card>
      <CardHeader
        title="Follow-ups"
        meta={items.length === 0 ? "Nothing outstanding" : `${items.length} open`}
      />
      <CardBody className="flex flex-col gap-3">
        <QuickTask
          revalidate={revalidate}
          team={team}
          placeholder={placeholder ?? "Add a follow-up…"}
          {...scope}
        />
        {items.length > 0 ? (
          <TaskList
            tasks={items}
            revalidate={revalidate}
            showOwner
            grouped={false}
            emptyTitle="Nothing outstanding"
          />
        ) : null}
      </CardBody>
    </Card>
  );
}
