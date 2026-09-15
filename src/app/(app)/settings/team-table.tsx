"use client";

import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { setUserActive, setUserRole } from "@/lib/actions/settings";
import { relativeTime } from "@/lib/utils";

export type TeamRow = {
  id: string;
  name: string;
  email: string;
  photo: string | null;
  jobTitle: string | null;
  role: "admin" | "member" | "viewer";
  /** "entra" means the tenant owns this person's access, not this table. */
  roleSource: "entra" | "manual";
  isActive: boolean;
  lastSeenAt: Date | null;
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

const ROLE_HINT: Record<string, string> = {
  admin: "Everything, including settings and roles",
  member: "Create and edit records",
  viewer: "Read only",
};

export function TeamTable({ rows, currentUserId }: { rows: TeamRow[]; currentUserId: string }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <TableShell>
        <Table className="min-w-[38rem]">
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Access</Th>
              <Th>Last seen</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td>
                  <span className="flex items-center gap-2.5">
                    <Avatar name={row.name} src={row.photo} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--text)]">
                        {row.name}
                        {row.id === currentUserId ? (
                          <span className="ml-1.5 text-[11px] font-normal text-[var(--text-faint)]">
                            you
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-[12px] text-[var(--text-muted)]">
                        {row.jobTitle ? `${row.jobTitle} · ` : ""}
                        {row.email}
                      </span>
                    </span>
                  </span>
                </Td>
                <Td>
                  <RoleSelect row={row} onError={setError} />
                  <span className="mt-0.5 block text-[11px] text-[var(--text-faint)]">
                    {ROLE_HINT[row.role]}
                  </span>
                </Td>
                <Td className="text-[12px] text-[var(--text-muted)]">
                  {row.lastSeenAt ? relativeTime(row.lastSeenAt) : "Never"}
                </Td>
                <Td>
                  <ActiveToggle row={row} onError={setError} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableShell>
    </div>
  );
}

function RoleSelect({
  row,
  onError,
}: {
  row: TeamRow;
  onError: (message: string | null) => void;
}) {
  const [pending, start] = useTransition();

  // Entra is the authority once it is assigning app roles. Showing an editable
  // control here would promise something the next sign-in would undo.
  if (row.roleSource === "entra") {
    return (
      <span className="flex items-center gap-1.5">
        <Badge tone="neutral">{ROLE_LABEL[row.role] ?? row.role}</Badge>
        <span className="text-[11px] text-[var(--text-faint)]">via Entra</span>
      </span>
    );
  }

  return (
    <Select
      aria-label={`Access level for ${row.name}`}
      defaultValue={row.role}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          const result = await setUserRole(row.id, e.target.value);
          onError(result.ok ? null : (result.message ?? "That didn't work."));
        })
      }
      className="h-8 w-auto min-w-28 text-[12px]"
    >
      <option value="admin">Admin</option>
      <option value="member">Member</option>
      <option value="viewer">Viewer</option>
    </Select>
  );
}

function ActiveToggle({
  row,
  onError,
}: {
  row: TeamRow;
  onError: (message: string | null) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await setUserActive(row.id, !row.isActive);
          onError(result.ok ? null : (result.message ?? "That didn't work."));
        })
      }
      className="disabled:opacity-50"
      aria-label={row.isActive ? `Suspend ${row.name}` : `Restore access for ${row.name}`}
    >
      <Badge tone={row.isActive ? "ok" : "muted"} dot>
        {row.isActive ? "Active" : "Suspended"}
      </Badge>
    </button>
  );
}
