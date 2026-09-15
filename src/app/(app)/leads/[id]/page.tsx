import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowUpRight, Building2, Globe, Mail, Phone } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DataRow } from "@/components/ui/field";
import { Avatar } from "@/components/ui/avatar";
import { LEAD_STAGES, StatusBadge } from "@/components/ui/status";
import { Timeline } from "@/components/app/timeline";
import { LogCommunication } from "@/components/app/log-communication";
import { RecordTasks } from "@/components/app/record-tasks";
import { TrackVisit } from "@/components/app/track-visit";
import { StagePicker } from "./stage-picker";
import { LeadForm } from "../lead-form";
import { getDb } from "@/lib/db";
import { leads, users } from "@/lib/db/schema";
import { listCommunications } from "@/lib/data/communications";
import { listTeam } from "@/lib/data/common";
import { convertLead, updateLead } from "@/lib/actions/leads";
import { requireUser } from "@/lib/auth/session";
import { formatDate, money, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const [row] = await getDb()
    .select({ lead: leads, ownerName: users.name, ownerPhoto: users.photo })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(eq(leads.id, id))
    .limit(1);
  return row ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const row = await load(id).catch(() => null);
  return { title: row?.lead.companyName ?? "Lead" };
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  const { id } = await params;

  const row = await load(id);
  if (!row) notFound();
  const { lead, ownerName, ownerPhoto } = row;

  const [entries, team] = await Promise.all([
    listCommunications({ leadId: id }),
    listTeam(),
  ]);

  const convert = convertLead.bind(null, id);
  const update = updateLead.bind(null, id);

  return (
    <>
      <TrackVisit
        href={`/leads/${lead.id}`}
        label={lead.companyName}
        kind="lead"
      />
      <PageHeader
        title={lead.companyName}
        crumbs={[{ label: "Leads", href: "/leads" }, { label: lead.companyName }]}
        eyebrow={<StatusBadge map={LEAD_STAGES} value={lead.stage} dot />}
        description={lead.interest}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-[var(--text-muted)]">
            {lead.contactName ? <span>{lead.contactName}</span> : null}
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="inline-flex items-center gap-1.5 hover:text-[var(--text)] hover:underline underline-offset-2"
              >
                <Mail className="size-3.5" />
                {lead.email}
              </a>
            ) : null}
            {lead.phone ? (
              <a
                href={`tel:${lead.phone.replace(/\s/g, "")}`}
                className="inline-flex items-center gap-1.5 hover:text-[var(--text)]"
              >
                <Phone className="size-3.5" />
                {lead.phone}
              </a>
            ) : null}
            {lead.website ? (
              <a
                href={lead.website}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 hover:text-[var(--text)] hover:underline underline-offset-2"
              >
                <Globe className="size-3.5" />
                {lead.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </div>
        }
        actions={
          lead.convertedCustomerId ? (
            <Link
              href={`/customers/${lead.convertedCustomerId}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
            >
              <Building2 className="size-4" />
              Open the customer record
            </Link>
          ) : (
            <form action={convert}>
              <Button type="submit" variant="primary">
                Convert to customer
                <ArrowUpRight />
              </Button>
            </form>
          )
        }
      />

      <PageBody className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Pipeline stage"
              meta={`Last touched ${relativeTime(lead.updatedAt)}`}
            />
            <CardBody>
              <StagePicker leadId={lead.id} stage={lead.stage} />
              {lead.stage === "lost" && lead.lostReason ? (
                <p className="mt-3 text-[13px] text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text)]">Why we lost it:</span>{" "}
                  {lead.lostReason}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <RecordTasks
            scope={{ leadId: lead.id }}
            revalidate={`/leads/${lead.id}`}
            placeholder="Ring them back on Thursday…"
          />

          <Card>
            <CardHeader
              title="History"
              meta={`${entries.length} ${entries.length === 1 ? "entry" : "entries"} · emails linked from Microsoft 365 appear here`}
              action={
                <ButtonLink href={`/inbox?lead=${lead.id}`} variant="ghost" size="sm">
                  <Mail />
                  Link email
                </ButtonLink>
              }
            />
            <CardBody className="flex flex-col gap-4">
              <LogCommunication leadId={lead.id} redirectTo={`/leads/${lead.id}`} />
              <Timeline
                entries={entries}
                emptyTitle="No history on this lead yet"
                emptyDescription="Log the first call or note. Once they become a customer this history follows them across."
                currentUserId={user.id}
                canModerate={user.role === "admin"}
                revalidate={`/leads/${lead.id}`}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Lead details" meta="Everything on record" />
            <CardBody>
              <LeadForm
                action={update}
                lead={lead}
                team={team}
                submitLabel="Save changes"
                cancelHref="/leads"
              />
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="At a glance" />
            <CardBody>
              <dl className="divide-y divide-[var(--border-soft)]">
                <DataRow label="Owner">
                  {ownerName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar name={ownerName} src={ownerPhoto} size="xs" />
                      {ownerName}
                    </span>
                  ) : (
                    <span className="text-[var(--text-faint)]">Unassigned</span>
                  )}
                </DataRow>
                <DataRow label="Value">
                  <span className="tabular font-medium">{money(lead.valueAud)}</span>
                  {lead.probability !== null ? (
                    <span className="ml-2 text-[var(--text-muted)]">
                      at {lead.probability}%
                    </span>
                  ) : null}
                </DataRow>
                <DataRow label="Expected close">{formatDate(lead.expectedCloseDate)}</DataRow>
                <DataRow label="Source">{lead.source ?? "—"}</DataRow>
                <DataRow label="Location">
                  {[lead.suburb, lead.state].filter(Boolean).join(", ") || "—"}
                </DataRow>
                <DataRow label="Created">{formatDate(lead.createdAt)}</DataRow>
              </dl>
            </CardBody>
          </Card>

          {lead.nextAction ? (
            <Card className="border-[var(--color-sunrise-200)] bg-[var(--color-sunrise-50)] dark:border-[var(--color-sunrise-800)] dark:bg-[var(--color-sunrise-900)]/40">
              <CardBody>
                <p className="text-[11px] font-semibold tracking-[0.06em] text-[var(--color-sunrise-700)] uppercase dark:text-[var(--color-sunrise-300)]">
                  Next action
                </p>
                <p className="mt-1.5 text-[14px] leading-6 font-medium text-[var(--text)]">
                  {lead.nextAction}
                </p>
                {lead.nextActionAt ? (
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                    Due {formatDate(lead.nextActionAt)} · {relativeTime(lead.nextActionAt)}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {lead.tags.length > 0 ? (
            <Card>
              <CardHeader title="Tags" />
              <CardBody className="flex flex-wrap gap-1.5">
                {lead.tags.map((tag) => (
                  <Badge key={tag} tone="brand">
                    {tag}
                  </Badge>
                ))}
              </CardBody>
            </Card>
          ) : null}

          {lead.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <p className="text-[13px] leading-6 whitespace-pre-line text-[var(--text)]">
                  {lead.notes}
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
