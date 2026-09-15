"use client";

import { useState } from "react";
import {
  Cake,
  Coffee,
  Link2,
  Mail,
  PenLine,
  Pencil,
  Phone,
  Plus,
  Salad,
  Smartphone,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ContactForm } from "./contact-form";
import { ContactFacts } from "./contact-facts";
import { createContact, updateContact } from "@/lib/actions/contacts";
import type { Contact, ContactFact } from "@/lib/db/schema";
import { cn, daysUntilAnniversary, formatDate } from "@/lib/utils";

export type ContactWithFacts = Contact & { facts: ContactFact[] };

export function ContactsPanel({
  customerId,
  contacts,
}: {
  customerId: string;
  contacts: ContactWithFacts[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {contacts.length === 0 && !adding ? (
        <EmptyState
          compact
          title="No people yet"
          description="Add the people you actually deal with — and the details that make the next call easier."
          action={
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add a person
            </Button>
          }
        />
      ) : null}

      {contacts.map((contact) => (
        <article
          key={contact.id}
          className={cn(
            "rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5",
            "transition-colors duration-150",
            contact.isPrimary && "border-[var(--color-coastal-300)]",
          )}
        >
          <div className="flex items-start gap-3">
            <Avatar name={`${contact.firstName} ${contact.lastName ?? ""}`} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-[14px] font-semibold text-[var(--text)]">
                  {contact.firstName} {contact.lastName}
                </h3>
                {contact.pronouns ? (
                  <span className="text-[11px] text-[var(--text-faint)]">
                    ({contact.pronouns})
                  </span>
                ) : null}
                {contact.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                {contact.isDecisionMaker ? <Badge tone="accent">Decides</Badge> : null}
              </div>
              {contact.jobTitle ? (
                <p className="text-[12px] text-[var(--text-muted)]">{contact.jobTitle}</p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
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
                {contact.mobile ? (
                  <a
                    href={`tel:${contact.mobile.replace(/\s/g, "")}`}
                    className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    <Smartphone className="size-3.5" />
                    {contact.mobile}
                  </a>
                ) : null}
                {contact.email ? (
                  <a
                    href={`https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(
                      contact.email,
                    )}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 text-[var(--color-coastal-600)] hover:underline underline-offset-2"
                  >
                    <PenLine className="size-3.5" />
                    Write in Outlook
                  </a>
                ) : null}
                {contact.linkedin ? (
                  <a
                    href={contact.linkedin}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    <Link2 className="size-3.5" />
                    LinkedIn
                  </a>
                ) : null}
              </div>

              <PersonalDetails contact={contact} />

              {contact.notes ? (
                <p className="mt-2 text-[12px] leading-5 whitespace-pre-line text-[var(--text-muted)]">
                  {contact.notes}
                </p>
              ) : null}

              <div className="mt-3">
                <ContactFacts
                  contactId={contact.id}
                  customerId={customerId}
                  facts={contact.facts}
                />
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              aria-label={editing === contact.id ? "Close editor" : `Edit ${contact.firstName}`}
              onClick={() => setEditing(editing === contact.id ? null : contact.id)}
            >
              {editing === contact.id ? <X /> : <Pencil />}
            </Button>
          </div>

          {editing === contact.id ? (
            <div className="mt-4 border-t border-[var(--border-soft)] pt-4">
              <ContactForm
                action={updateContact.bind(null, contact.id)}
                customerId={customerId}
                contact={contact}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSaved={() => setEditing(null)}
              />
            </div>
          ) : null}
        </article>
      ))}

      {adding ? (
        <div className="rounded-[10px] border border-[var(--color-coastal-300)] bg-[var(--surface)] p-3.5">
          <h3 className="mb-4 text-[13px] font-semibold text-[var(--text)]">
            Add a person
          </h3>
          <ContactForm
            action={createContact}
            customerId={customerId}
            submitLabel="Add person"
            onCancel={() => setAdding(false)}
            onSaved={() => setAdding(false)}
          />
        </div>
      ) : contacts.length > 0 ? (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setAdding(true)}>
          <Plus />
          Add a person
        </Button>
      ) : null}
    </div>
  );
}

function PersonalDetails({ contact }: { contact: Contact }) {
  const days = daysUntilAnniversary(contact.birthday);
  const items = [
    contact.coffeeOrder && { icon: Coffee, text: contact.coffeeOrder },
    contact.dietary && { icon: Salad, text: contact.dietary },
    contact.birthday && {
      icon: Cake,
      text: `${formatDate(contact.birthday, "day")}${
        days !== null && days <= 30 ? ` · ${days === 0 ? "today" : `in ${days} days`}` : ""
      }`,
      highlight: days !== null && days <= 14,
    },
  ].filter(Boolean) as { icon: typeof Coffee; text: string; highlight?: boolean }[];

  if (items.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {items.map(({ icon: Icon, text, highlight }) => (
        <li
          key={text}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px]",
            highlight
              ? "bg-[var(--color-sunrise-50)] text-[var(--color-sunrise-700)] dark:bg-[var(--color-sunrise-900)]/40 dark:text-[var(--color-sunrise-200)]"
              : "bg-[var(--surface-3)] text-[var(--text-muted)]",
          )}
        >
          <Icon className="size-3.5" />
          {text}
        </li>
      ))}
    </ul>
  );
}
