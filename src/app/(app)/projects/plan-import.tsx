"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Field, Select } from "@/components/ui/field";
import { ActionForm, SubmitButton, useFieldError } from "@/components/ui/form";
import {
  createProjectFromPlan,
  listPlannerGroups,
  listPlannerPlans,
  type GroupOption,
  type PlanOption,
} from "@/lib/actions/planner";

/**
 * Starts a project from a plan that already exists in Planner. The plan's
 * buckets become phases and its tasks steps, and the two stay linked.
 */
export function PlanImport({
  customers,
  defaultCustomerId,
}: {
  customers: { id: string; name: string }[];
  defaultCustomerId?: string;
}) {
  const uid = useId();
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [groupId, setGroupId] = useState("");
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlannerGroups().then((res) => {
      if (!res.ok) return setError(res.message ?? "Could not list your groups.");
      setGroups(res.groups ?? []);
      setGroupId(res.defaultGroupId ?? res.groups?.[0]?.id ?? "");
    });
  }, []);

  useEffect(() => {
    if (!groupId) return;
    let live = true;
    listPlannerPlans(groupId).then((res) => {
      if (!live) return;
      if (!res.ok) return setError(res.message ?? "Could not list the plans in that group.");
      setPlans(res.plans ?? []);
    });
    return () => {
      live = false;
    };
  }, [groupId]);

  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 text-[12px] leading-5 text-[var(--danger)]">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        {error}
      </p>
    );
  }

  if (!groups) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
        <Loader2 className="size-3.5 animate-spin" />
        Looking up your Planner groups…
      </p>
    );
  }

  const available = (plans ?? []).filter((p) => !p.linkedTo);

  return (
    <ActionForm action={createProjectFromPlan} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Group" htmlFor={`${uid}-group`}>
          <Select id={`${uid}-group`} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <PlanField id={`${uid}-plan`} plans={plans} available={available} />
        <CustomerField
          id={`${uid}-customer`}
          customers={customers}
          defaultCustomerId={defaultCustomerId}
        />
      </div>
      <div>
        <SubmitButton size="sm" variant="secondary">
          Create project from plan
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

function PlanField({
  id,
  plans,
  available,
}: {
  id: string;
  plans: PlanOption[] | null;
  available: PlanOption[];
}) {
  return (
    <Field label="Plan" htmlFor={id} error={useFieldError("planId")}>
      <Select id={id} name="planId" defaultValue="" key={plans?.length ?? -1}>
        <option value="" disabled>
          {plans === null
            ? "Loading plans…"
            : available.length === 0
              ? "No unlinked plans to link"
              : "Choose a plan"}
        </option>
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function CustomerField({
  id,
  customers,
  defaultCustomerId,
}: {
  id: string;
  customers: { id: string; name: string }[];
  defaultCustomerId?: string;
}) {
  return (
    <Field label="Business partner" htmlFor={id} error={useFieldError("customerId")}>
      <Select id={id} name="customerId" defaultValue={defaultCustomerId ?? ""}>
        <option value="" disabled>
          Choose…
        </option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
