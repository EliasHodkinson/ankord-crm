"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/field";
import { ActionForm, SaveIndicator, SubmitButton } from "@/components/ui/form";
import { listPlannerGroups, savePlannerGroup, type GroupOption } from "@/lib/actions/planner";
import { relativeTime } from "@/lib/utils";

export type PlannerLinkRow = {
  projectId: string;
  projectName: string;
  title: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
};

/**
 * Which Microsoft 365 group new plans go in, and how every linked project's
 * sync is doing — the one place a failing link shows up without opening the
 * project.
 */
export function PlannerSettings({
  current,
  links,
}: {
  current: { id: string | null; name: string | null };
  links: PlannerLinkRow[];
}) {
  const uid = useId();
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [groupId, setGroupId] = useState(current.id ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlannerGroups().then((res) => {
      if (!res.ok) return setError(res.message ?? "Could not list your groups.");
      setGroups(res.groups ?? []);
      if (!current.id && res.groups?.[0]) setGroupId(res.groups[0].id);
    });
  }, [current.id]);

  const chosen = groups?.find((g) => g.id === groupId);

  return (
    <div className="flex flex-col gap-4">
      {groups === null && !error ? (
        <p className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
          <Loader2 className="size-3.5 animate-spin" />
          Looking up your Microsoft 365 groups…
        </p>
      ) : null}

      {groups ? (
        <ActionForm action={savePlannerGroup} className="flex flex-col gap-3">
          <Field
            label="Group for new plans"
            htmlFor={`${uid}-group`}
            hint="Its members can see and edit the plans in Planner and Teams. Anyone creating a plan can still pick another group they belong to."
          >
            <Select
              id={`${uid}-group`}
              name="plannerGroupId"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              {current.id && !groups.some((g) => g.id === current.id) ? (
                <option value={current.id}>{current.name ?? "Current group"}</option>
              ) : null}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <input
            type="hidden"
            name="plannerGroupName"
            value={chosen?.name ?? current.name ?? ""}
          />
          <div className="flex items-center gap-3">
            <SubmitButton size="sm" variant="secondary">
              Save
            </SubmitButton>
            <SaveIndicator />
          </div>
        </ActionForm>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-2 text-[12px] leading-5 text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="border-t border-[var(--border-soft)] pt-3">
        <p className="text-[12px] font-medium text-[var(--text-muted)]">
          Linked projects{" "}
          <span className="font-normal text-[var(--text-faint)] tabular">{links.length}</span>
        </p>
        {links.length === 0 ? (
          <p className="mt-1 text-[12px] text-[var(--text-faint)]">
            None yet. Link a plan from a project&rsquo;s page, or start a new project from a plan.
          </p>
        ) : (
          <ul className="mt-1.5 divide-y divide-[var(--border-soft)]">
            {links.map((l) => (
              <li key={l.projectId} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                <Link
                  href={`/projects/${l.projectId}`}
                  className="text-[13px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
                >
                  {l.projectName}
                </Link>
                {l.lastError ? (
                  <Badge tone="danger" dot>
                    Sync failed
                  </Badge>
                ) : (
                  <Badge tone="ok" dot>
                    In sync
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-[var(--text-faint)]">
                  {l.lastSyncedAt ? `Synced ${relativeTime(l.lastSyncedAt)}` : "Not synced yet"}
                </span>
                {l.lastError ? (
                  <p className="w-full text-[12px] leading-5 text-[var(--danger)]">{l.lastError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
