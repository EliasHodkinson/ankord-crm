"use client";

import { Select } from "@/components/ui/field";
import { useRetainedValue } from "@/components/ui/form";
import type { TeamMember } from "@/lib/data/common";

export function OwnerSelect({
  team,
  name = "ownerId",
  defaultValue,
  id,
  allowUnassigned = true,
}: {
  team: TeamMember[];
  name?: string;
  defaultValue?: string | null;
  id?: string;
  allowUnassigned?: boolean;
}) {
  const retained = useRetainedValue(name);
  return (
    <Select id={id} name={name} defaultValue={retained ?? defaultValue ?? ""}>
      {allowUnassigned ? <option value="">Unassigned</option> : null}
      {team.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}
        </option>
      ))}
    </Select>
  );
}
