import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { AlertTriangle, Mail } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { MessagePicker, type PickableMessage } from "./message-picker";
import { getDb } from "@/lib/db";
import { communications, contacts, customers, leads, projects } from "@/lib/db/schema";
import { getGraphToken, requireUser } from "@/lib/auth/session";
import {
  addressOf,
  cleanText,
  messagesWithAddresses,
  nameOf,
  recentMessages,
  recipientList,
  searchMessages,
  type GraphMessage,
} from "@/lib/graph/mail";
import { describeGraphFailure } from "@/lib/graph/errors";
import { truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "Link email" };
export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; customer?: string; project?: string; lead?: string }>;
}) {
  await requireUser();
  const { q, customer, project, lead } = await searchParams;
  const db = getDb();

  const [customerList, projectList, leadList] = await Promise.all([
    db.select({ id: customers.id, name: customers.name }).from(customers).orderBy(asc(customers.name)),
    db
      .select({ id: projects.id, name: projects.name, customerId: projects.customerId })
      .from(projects)
      .orderBy(asc(projects.name)),
    db.select({ id: leads.id, name: leads.companyName }).from(leads).orderBy(asc(leads.companyName)),
  ]);

  // With a customer in context, seed the search from the addresses we know.
  let seedAddresses: string[] = [];
  let contextLabel: string | null = null;

  const contextCustomerId = customer ?? projectList.find((p) => p.id === project)?.customerId;

  if (contextCustomerId) {
    const [row] = await db
      .select({ name: customers.name, email: customers.email })
      .from(customers)
      .where(eq(customers.id, contextCustomerId))
      .limit(1);
    const people = await db
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.customerId, contextCustomerId));

    contextLabel = row?.name ?? null;
    seedAddresses = [row?.email, ...people.map((p) => p.email)].filter(
      (a): a is string => Boolean(a),
    );
  } else if (lead) {
    const [row] = await db
      .select({ name: leads.companyName, email: leads.email })
      .from(leads)
      .where(eq(leads.id, lead))
      .limit(1);
    contextLabel = row?.name ?? null;
    if (row?.email) seedAddresses = [row.email];
  }

  let messages: GraphMessage[] = [];
  let graphError: string | null = null;

  try {
    const token = await getGraphToken();
    if (q?.trim()) {
      messages = await searchMessages(token, q.trim());
    } else if (seedAddresses.length > 0) {
      messages = await messagesWithAddresses(token, seedAddresses);
    } else {
      messages = await recentMessages(token, 30);
    }
  } catch (error) {
    graphError = describeGraphFailure(error);
  }

  // Mark anything already in the CRM so it cannot be linked twice.
  const internetIds = messages
    .map((m) => m.internetMessageId)
    .filter((id): id is string => Boolean(id));

  const linkedIds = new Set(
    internetIds.length === 0
      ? []
      : (
          await db
            .select({ id: communications.graphInternetMessageId })
            .from(communications)
            .where(inArray(communications.graphInternetMessageId, internetIds))
        )
          .map((r) => r.id)
          .filter((id): id is string => Boolean(id)),
  );

  const pickable: PickableMessage[] = messages
    .filter((m) => !m.isDraft)
    .map((m) => ({
      id: m.id,
      subject: cleanText(m.subject ?? "") || "(no subject)",
      preview: truncate(cleanText(m.bodyPreview ?? ""), 400),
      from: nameOf(m.from ?? m.sender) ?? addressOf(m.from ?? m.sender) ?? "Unknown",
      to:
        recipientList(m.toRecipients)
          .map((r) => r.name ?? r.address)
          .slice(0, 3)
          .join(", ") || "—",
      receivedAt: m.receivedDateTime,
      hasAttachments: Boolean(m.hasAttachments),
      webLink: m.webLink ?? null,
      alreadyLinked: Boolean(m.internetMessageId && linkedIds.has(m.internetMessageId)),
    }));

  return (
    <>
      <PageHeader
        title="Link email"
        description={
          contextLabel
            ? `Messages to and from ${contextLabel}, straight out of your Outlook mailbox. Anything you link becomes part of the shared history.`
            : "Search your Outlook mailbox and attach the conversation to a customer, project or lead. Linked emails are visible to everyone in the CRM unless you mark them private."
        }
        meta={
          contextCustomerId ? (
            <Link
              href={`/customers/${contextCustomerId}`}
              className="text-[13px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
            >
              Back to {contextLabel ?? "the customer"}
            </Link>
          ) : null
        }
      />

      <PageBody className="flex flex-col gap-4">
        <FilterBar
          searchPlaceholder="Search your mailbox — name, address or subject…"
        />

        {graphError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-[10px] border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-4 py-3"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
            <div>
              <p className="text-[13px] font-medium text-[var(--danger)]">
                Couldn&rsquo;t reach your mailbox
              </p>
              <p className="mt-0.5 text-[12px] leading-5 text-[var(--text-muted)]">
                {graphError}
              </p>
            </div>
          </div>
        ) : pickable.length === 0 && !q ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title="Nothing to show yet"
              description="Search for a person or a subject line and the matching emails from your mailbox appear here, ready to attach to a record."
            />
          </div>
        ) : (
          <MessagePicker
            messages={pickable}
            targets={{ customers: customerList, projects: projectList, leads: leadList }}
            defaultCustomerId={contextCustomerId}
            defaultProjectId={project}
            defaultLeadId={lead}
          />
        )}

        <p className="flex items-start gap-2 text-[12px] leading-5 text-[var(--text-faint)]">
          <Mail className="mt-0.5 size-3.5 shrink-0" />
          The CRM reads mail as you. It never sees a mailbox you cannot open in
          Outlook, and it never sends anything on your behalf.
        </p>
      </PageBody>
    </>
  );
}
