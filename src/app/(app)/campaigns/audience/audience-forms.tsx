"use client";

import * as React from "react";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton, useFormResult } from "@/components/ui/form";
import { TextAreaField, TextField } from "@/components/app/form-kit";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { MARKETING_CONSENT, StatusBadge, SUPPRESSION_REASON } from "@/components/ui/status";
import { addSuppressions, deleteSegment, removeSuppression, setMarketingConsent } from "@/lib/actions/campaigns";
import { formatDate } from "@/lib/utils";

type Person = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  consent: "express" | "inferred" | null;
  customerId: string;
  customerName: string;
  suppressed: string | null;
};

export function ConsentTable({ people, writer }: { people: Person[]; writer: boolean }) {
  const router = useRouter();
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [message, setMessage] = React.useState<string | null>(null);

  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = (value: string) => {
    const consent = value === "none" ? null : (value as "express" | "inferred");
    start(async () => {
      const result = await setMarketingConsent([...chosen], consent);
      setMessage(result.message ?? null);
      if (result.ok) setChosen(new Set());
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {writer ? (
        <div className="flex min-h-9 flex-wrap items-center gap-2 text-[13px]">
          <span className="text-[var(--text-muted)]">
            {chosen.size ? `${chosen.size} chosen` : "Choose people to record their consent."}
          </span>
          {chosen.size ? (
            <>
              <Select className="h-8 w-56" value="" onChange={(e) => e.target.value && apply(e.target.value)} disabled={pending}>
                <option value="">Set consent to…</option>
                <option value="express">{MARKETING_CONSENT.express.label}</option>
                <option value="inferred">{MARKETING_CONSENT.inferred.label}</option>
                <option value="none">{MARKETING_CONSENT.none.label}</option>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>
                Clear
              </Button>
            </>
          ) : null}
          {pending ? <Loader2 className="size-4 animate-spin text-[var(--text-faint)]" /> : null}
          {message && !pending ? <span role="status" className="text-[12px] text-[var(--ok)]">{message}</span> : null}
        </div>
      ) : null}
      <TableShell className="max-h-[38rem]">
        <Table>
          <thead>
            <tr>
              {writer ? (
                <Th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Choose everyone shown"
                    checked={people.length > 0 && chosen.size === people.length}
                    onChange={(e) => setChosen(e.target.checked ? new Set(people.map((p) => p.id)) : new Set())}
                    className="size-4 accent-[var(--accent)]"
                  />
                </Th>
              ) : null}
              <Th>Person</Th>
              <Th>Business partner</Th>
              <Th>Consent</Th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <Tr key={p.id}>
                {writer ? (
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Choose ${p.firstName}`}
                      checked={chosen.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="size-4 accent-[var(--accent)]"
                    />
                  </Td>
                ) : null}
                <Td>
                  <span className="font-medium">
                    {p.firstName} {p.lastName}
                  </span>
                  <span className="block text-[12px] text-[var(--text-muted)]">{p.email}</span>
                </Td>
                <Td>
                  <Link href={`/customers/${p.customerId}`} className="hover:underline underline-offset-2">
                    {p.customerName}
                  </Link>
                </Td>
                <Td>
                  {p.suppressed ? (
                    <StatusBadge map={SUPPRESSION_REASON} value={p.suppressed} />
                  ) : (
                    <StatusBadge map={MARKETING_CONSENT} value={p.consent ?? "none"} />
                  )}
                </Td>
              </Tr>
            ))}
            {people.length === 0 ? (
              <Tr>
                <Td colSpan={writer ? 4 : 3} className="py-8 text-center text-[var(--text-muted)]">
                  Nobody matches.
                </Td>
              </Tr>
            ) : null}
          </tbody>
        </Table>
      </TableShell>
    </div>
  );
}

export function SuppressionForm() {
  return (
    <ActionForm action={addSuppressions}>
      <div className="flex flex-col gap-3">
        <TextAreaField name="emails" label="Add addresses" rows={2} placeholder="someone@example.com.au" hint="Separate several with commas or new lines." />
        <TextField name="note" label="Why (optional)" placeholder="Asked by phone" />
        <div className="flex items-center gap-3">
          <SubmitButton variant="secondary" pendingLabel="Adding…">
            Don&rsquo;t email these
          </SubmitButton>
          <Done />
        </div>
      </div>
    </ActionForm>
  );
}

function Done() {
  const result = useFormResult();
  return result?.ok && result.message ? <span role="status" className="text-[12px] text-[var(--ok)]">{result.message}</span> : null;
}

export function SuppressionList({
  rows,
  writer,
}: {
  rows: { suppression: { email: string; reason: string; note: string | null; createdAt: Date }; campaignName: string | null; byName: string | null }[];
  writer: boolean;
}) {
  const [pending, start] = useTransition();
  if (!rows.length) return null;
  return (
    <ul className="max-h-[24rem] overflow-y-auto border-t border-[var(--border-soft)] scrollbar-slim">
      {rows.map(({ suppression: s, campaignName, byName }) => (
        <li key={s.email} className="group flex items-start gap-2 border-b border-[var(--border-soft)] px-4 py-2.5 last:border-0">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-[var(--text)]">{s.email}</p>
            <p className="truncate text-[11px] text-[var(--text-faint)]">
              {formatDate(s.createdAt)}
              {campaignName ? ` · from ${campaignName}` : byName ? ` · by ${byName}` : ""}
              {s.note ? ` · ${s.note}` : ""}
            </p>
          </div>
          <StatusBadge map={SUPPRESSION_REASON} value={s.reason} />
          {writer ? (
            <button
              type="button"
              disabled={pending}
              title="Allow email again"
              aria-label={`Allow email to ${s.email} again`}
              onClick={() => {
                if (window.confirm(`Allow marketing email to ${s.email} again? Only do this if they've asked.`)) {
                  start(async () => {
                    await removeSuppression(s.email);
                  });
                }
              }}
              className="grid size-6 place-items-center rounded-md text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--surface-3)] hover:text-[var(--text)] focus-visible:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function SegmentList({ segments, writer }: { segments: { id: string; name: string }[]; writer: boolean }) {
  const [pending, start] = useTransition();
  if (!segments.length) {
    return <p className="px-4 py-4 text-[13px] text-[var(--text-muted)]">None saved yet.</p>;
  }
  return (
    <ul>
      {segments.map((s) => (
        <li key={s.id} className="group flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-2.5 last:border-0">
          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{s.name}</span>
          {writer ? (
            <button
              type="button"
              disabled={pending}
              aria-label={`Delete ${s.name}`}
              onClick={() => {
                if (window.confirm(`Delete the saved audience “${s.name}”? Campaigns that used it keep their own copy.`)) {
                  start(async () => {
                    await deleteSegment(s.id);
                  });
                }
              }}
              className="grid size-6 place-items-center rounded-md text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--surface-3)] hover:text-[var(--text)] focus-visible:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
