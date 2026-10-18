"use client";

import { useState, useTransition } from "react";
import { RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ActionForm, SaveIndicator, SubmitButton } from "@/components/ui/form";
import { CheckboxField } from "@/components/app/form-kit";
import { SECTIONS, SECTION_INFO, type Section } from "@/lib/sections";
import { USER_ROLE, USER_ROLE_HINT } from "@/components/ui/status";
import {
  retryFolderGrant,
  saveCustomerGrants,
  saveSections,
  setPersonActive,
  setPersonRole,
} from "@/lib/actions/people";
import type { ActionState } from "@/lib/actions/shared";
import { CustomerPicker, type PickerCustomer } from "./customer-picker";

function Outcome({ result }: { result: ActionState | null }) {
  if (!result?.message) return null;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={
        result.ok
          ? "text-[12px] text-[var(--text-muted)]"
          : "text-[12px] leading-5 text-[var(--danger)]"
      }
    >
      {result.message}
    </p>
  );
}

export function RoleControl({
  userId,
  role,
  roleSource,
  isSelf,
}: {
  userId: string;
  role: string;
  roleSource: "entra" | "manual";
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Access level"
          defaultValue={role}
          disabled={pending || isSelf}
          onChange={(e) =>
            start(async () => {
              setResult(await setPersonRole(userId, e.target.value));
            })
          }
          className="h-9 w-auto min-w-40 text-[13px]"
        >
          {Object.entries(USER_ROLE).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {roleSource === "entra" ? (
          <span className="text-[12px] text-[var(--text-faint)]">
            Set by an Entra app role. You can restrict them here; anything wider is changed in Entra.
          </span>
        ) : null}
      </div>
      <p className="text-[12px] text-[var(--text-faint)]">{USER_ROLE_HINT[role]}</p>
      <Outcome result={result} />
    </div>
  );
}

export function ActiveControl({
  userId,
  isActive,
  isSelf,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <Badge tone={isActive ? "ok" : "muted"} dot>
          {isActive ? "Active" : "Suspended"}
        </Badge>
        {isSelf ? null : (
          <Button
            size="sm"
            variant={isActive ? "secondary" : "subtle"}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setResult(await setPersonActive(userId, !isActive));
              })
            }
          >
            {isActive ? "Suspend and sign out" : "Restore access"}
          </Button>
        )}
      </div>
      <Outcome result={result} />
    </div>
  );
}

export function RetryFolder({ userId, customerId }: { userId: string; customerId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(await retryFolderGrant(userId, customerId));
          })
        }
      >
        <RotateCw />
        {pending ? "Trying…" : "Try again"}
      </Button>
      <Outcome result={result} />
    </div>
  );
}

export function GrantsForm({
  userId,
  customers,
  initial,
}: {
  userId: string;
  customers: PickerCustomer[];
  initial: Record<string, "read" | "write">;
}) {
  return (
    <ActionForm action={saveCustomerGrants.bind(null, userId)}>
      <div className="flex flex-col gap-4">
        {/* Keyed on what is granted, so a save that changed it starts fresh. */}
        <CustomerPicker
          key={Object.entries(initial).sort().join()}
          customers={customers}
          initial={initial}
        />
        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Saving and updating SharePoint…">Save access</SubmitButton>
          <SaveIndicator />
        </div>
      </div>
    </ActionForm>
  );
}

export function SectionsForm({ userId, initial }: { userId: string; initial: Section[] }) {
  return (
    <ActionForm action={saveSections.bind(null, userId)}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <CheckboxField
              key={section}
              id={`section-${section}`}
              name={`section:${section}`}
              label={SECTION_INFO[section].label}
              hint={SECTION_INFO[section].hint}
              defaultChecked={initial.includes(section)}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Saving…">Save sections</SubmitButton>
          <SaveIndicator />
        </div>
      </div>
    </ActionForm>
  );
}
