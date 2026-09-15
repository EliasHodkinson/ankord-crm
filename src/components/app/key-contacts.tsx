"use client";

import { useId, useState, useTransition } from "react";
import { Mail, Pencil, Phone, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckboxField, FormRow, TextField } from "@/components/app/form-kit";
import { deleteKeyContact, saveKeyContact } from "@/lib/actions/projects";
import type { ProjectContact } from "@/lib/db/schema";

/**
 * Everyone involved in a project — client, Ankor'd, and the third parties who
 * hold something up. Blockers are called out because chasing them early is the
 * difference between a two-week job and a two-month one.
 */
export function KeyContacts({
  projectId,
  contacts,
}: {
  projectId: string;
  contacts: ProjectContact[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const blockers = contacts.filter((c) => c.isBlocker);

  return (
    <div className="flex flex-col gap-3">
      {blockers.length > 0 ? (
        <div className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2.5">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-[var(--warn)]">
            <TriangleAlert className="size-3.5" />
            Blocked on third parties — chase these early
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {blockers.map((c) => (
              <li key={c.id} className="text-[12px] leading-5 text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text)]">{c.name}</span>
                {c.organisation ? ` — ${c.organisation}` : ""}
                {c.needed ? ` · ${c.needed}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {contacts.length === 0 && !adding ? (
        <EmptyState
          compact
          title="No key contacts yet"
          description="List everyone this project depends on, and what you need from each of them. Mark the third parties who can hold it up."
          action={
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add a contact
            </Button>
          }
        />
      ) : null}

      {contacts.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="flex items-start gap-2.5">
                <Avatar name={contact.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-[var(--text)]">
                      {contact.name}
                    </span>
                    {contact.role ? (
                      <span className="text-[12px] text-[var(--text-muted)]">
                        {contact.role}
                      </span>
                    ) : null}
                    {contact.isBlocker ? <Badge tone="warn">Blocker</Badge> : null}
                  </p>
                  {contact.organisation ? (
                    <p className="text-[12px] text-[var(--text-muted)]">
                      {contact.organisation}
                    </p>
                  ) : null}

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                    {contact.email ? (
                      <a
                        href={`mailto:${contact.email}`}
                        className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:underline underline-offset-2"
                      >
                        <Mail className="size-3.5" />
                        {contact.email}
                      </a>
                    ) : null}
                    {contact.phone ? (
                      <a
                        href={`tel:${contact.phone.replace(/\s/g, "")}`}
                        className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        <Phone className="size-3.5" />
                        {contact.phone}
                      </a>
                    ) : null}
                  </div>

                  {contact.needed ? (
                    <p className="mt-1.5 text-[12px] leading-5 text-[var(--text)]">
                      <span className="text-[var(--text-faint)]">Need from them:</span>{" "}
                      {contact.needed}
                    </p>
                  ) : null}
                  {contact.bestContactMethod ? (
                    <p className="text-[12px] leading-5 text-[var(--text-muted)]">
                      Best reached: {contact.bestContactMethod}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={editing === contact.id ? "Close editor" : `Edit ${contact.name}`}
                    onClick={() => setEditing(editing === contact.id ? null : contact.id)}
                  >
                    {editing === contact.id ? <X /> : <Pencil />}
                  </Button>
                  <RemoveButton id={contact.id} name={contact.name} projectId={projectId} />
                </div>
              </div>

              {editing === contact.id ? (
                <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
                  <KeyContactForm
                    projectId={projectId}
                    contact={contact}
                    onDone={() => setEditing(null)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="rounded-lg border border-[var(--color-coastal-300)] bg-[var(--surface-2)] p-3">
          <KeyContactForm projectId={projectId} onDone={() => setAdding(false)} />
        </div>
      ) : contacts.length > 0 ? (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setAdding(true)}>
          <Plus />
          Add a contact
        </Button>
      ) : null}
    </div>
  );
}

function KeyContactForm({
  projectId,
  contact,
  onDone,
}: {
  projectId: string;
  contact?: ProjectContact;
  onDone: () => void;
}) {
  const uid = useId();
  const f = (k: string) => `${uid}-${k}`;

  return (
    <ActionForm
      action={saveKeyContact.bind(null, contact?.id ?? null)}
      className="flex flex-col gap-3"
      onSuccess={onDone}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="contactId" value={contact?.contactId ?? ""} />

      <FormRow cols={3}>
        <TextField
          name="name"
          label="Name"
          required
          id={f("name")}
          defaultValue={contact?.name}
          placeholder="Their contact"
        />
        <TextField
          name="organisation"
          label="Organisation"
          id={f("organisation")}
          defaultValue={contact?.organisation ?? ""}
          placeholder="Incumbent IT provider"
        />
        <TextField
          name="role"
          label="Role here"
          id={f("role")}
          defaultValue={contact?.role ?? ""}
          placeholder="Holds the DNS account"
        />
      </FormRow>
      <FormRow cols={3}>
        <TextField
          name="email"
          label="Email"
          type="email"
          id={f("email")}
          defaultValue={contact?.email ?? ""}
        />
        <TextField
          name="phone"
          label="Phone"
          type="tel"
          id={f("phone")}
          defaultValue={contact?.phone ?? ""}
        />
        <TextField
          name="bestContactMethod"
          label="Best reached by"
          id={f("bestContactMethod")}
          defaultValue={contact?.bestContactMethod ?? ""}
          placeholder="Phone — email goes unanswered"
        />
      </FormRow>
      <FormRow>
        <TextField
          name="needed"
          label="What we need from them"
          id={f("needed")}
          defaultValue={contact?.needed ?? ""}
          placeholder="Auth code and DNS zone export"
        />
        <CheckboxField
          id={f("isBlocker")}
          name="isBlocker"
          label="Can hold this project up"
          hint="Shows in the chase-early list at the top."
          defaultChecked={contact?.isBlocker}
        />
      </FormRow>

      <div className="flex items-center gap-2">
        <SubmitButton size="sm">{contact ? "Save" : "Add contact"}</SubmitButton>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

function RemoveButton({
  id,
  name,
  projectId,
}: {
  id: string;
  name: string;
  projectId: string;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() => start(() => void deleteKeyContact(id, projectId))}
        >
          Remove
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Remove ${name}`}
      onClick={() => setConfirming(true)}
    >
      <Trash2 />
    </Button>
  );
}
