import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Globe, Mail, MapPin, Phone, Plus } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { DataRow } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CUSTOMER_STATUS,
  PROJECT_HEALTH,
  PROJECT_STATUS,
  StatusBadge,
} from "@/components/ui/status";
import { ContactsPanel } from "@/components/app/contacts-panel";
import { Timeline } from "@/components/app/timeline";
import { LogCommunication } from "@/components/app/log-communication";
import { RecordTasks } from "@/components/app/record-tasks";
import { TrackVisit } from "@/components/app/track-visit";
import { FilesPanel } from "@/components/app/files-panel";
import { ConnectFolder } from "@/components/app/connect-folder";
import { CheckStructure } from "@/components/app/check-structure";
import { XeroAccount } from "@/components/app/xero-account";
import { CopilotBrief } from "@/components/app/copilot-brief";
import { RecordNav } from "@/components/app/record-nav";
import { AccountRegister } from "@/components/app/account-register";
import { CustomerForm } from "../customer-form";
import { getCustomer } from "@/lib/data/customers";
import { listCommunications } from "@/lib/data/communications";
import { getSettings, listTeam } from "@/lib/data/common";
import { readFolder } from "@/lib/data/files";
import { readXeroSnapshot } from "@/lib/data/xero";
import { readXeroConnection } from "@/lib/xero/auth";
import { updateCustomer } from "@/lib/actions/customers";
import { requireUser } from "@/lib/auth/session";
import { kindBadges } from "@/lib/contact-kinds";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const customer = await getCustomer(id).catch(() => null);
  return { title: customer?.name ?? "Customer" };
}

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireUser();
  const { id } = await params;

  const customer = await getCustomer(id);
  if (!customer) notFound();

  const [entries, team, settings, folder, xero, xeroConn] = await Promise.all([
    listCommunications({ customerId: id }),
    listTeam(),
    getSettings(),
    readFolder(customer.spDriveId, customer.spItemId),
    readXeroSnapshot(customer.xeroContactId),
    readXeroConnection().catch(() => null),
  ]);
  const xeroLive = Boolean(xeroConn);

  const address = [
    customer.addressLine1,
    customer.addressLine2,
    [customer.suburb, customer.state, customer.postcode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <TrackVisit
        href={`/customers/${customer.id}`}
        label={customer.name}
        kind="customer"
      />
      <PageHeader
        title={customer.name}
        crumbs={[{ label: "Business Partners", href: "/customers" }, { label: customer.name }]}
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge map={CUSTOMER_STATUS} value={customer.status} dot />
            {kindBadges(customer).map((label) => (
              <Badge key={label} tone="neutral">
                {label}
              </Badge>
            ))}
          </span>
        }
        description={customer.industry}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-[var(--text-muted)]">
            {customer.phone ? (
              <a
                href={`tel:${customer.phone.replace(/\s/g, "")}`}
                className="inline-flex items-center gap-1.5 hover:text-[var(--text)]"
              >
                <Phone className="size-3.5" />
                {customer.phone}
              </a>
            ) : null}
            {customer.email ? (
              <a
                href={`mailto:${customer.email}`}
                className="inline-flex items-center gap-1.5 hover:text-[var(--text)] hover:underline underline-offset-2"
              >
                <Mail className="size-3.5" />
                {customer.email}
              </a>
            ) : null}
            {customer.website ? (
              <a
                href={customer.website}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 hover:text-[var(--text)] hover:underline underline-offset-2"
              >
                <Globe className="size-3.5" />
                {customer.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
            {address ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {address}
              </span>
            ) : null}
          </div>
        }
        actions={
          <ButtonLink href={`/projects/new?customer=${customer.id}`} variant="primary">
            <Plus />
            New project
          </ButtonLink>
        }
      />

      <PageBody className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[10rem_minmax(0,1fr)_23rem]">
        <RecordNav
          className="col-span-full xl:col-span-1"
          sections={[
            { id: "projects", label: "Projects", count: customer.projects.length },
            { id: "people", label: "People", count: customer.contacts.length },
            { id: "history", label: "History", count: entries.length },
            { id: "accounts", label: "Accounts", count: customer.accounts.length },
            { id: "xero", label: "Xero" },
            { id: "details", label: "Details" },
            { id: "files", label: "Files" },
          ]}
        />
        <div className="flex flex-col gap-5">
          <Card id="projects" className="scroll-mt-20">
            <CardHeader
              title="Projects"
              meta={
                customer.projects.length === 0
                  ? "Nothing running yet"
                  : `${customer.projects.length} on record`
              }
              action={
                <ButtonLink
                  href={`/projects/new?customer=${customer.id}`}
                  variant="ghost"
                  size="sm"
                >
                  <Plus />
                  Add
                </ButtonLink>
              }
            />
            {customer.projects.length === 0 ? (
              <EmptyState
                compact
                title="No projects for this business partner"
                description="Start one from a runbook template — phases, steps, key contacts and an account register, ready to work through."
                action={
                  <ButtonLink
                    href={`/projects/new?customer=${customer.id}`}
                    variant="primary"
                    size="sm"
                  >
                    <Plus />
                    New project
                  </ButtonLink>
                }
              />
            ) : (
              <ul className="divide-y divide-[var(--border-soft)]">
                {customer.projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-[var(--text)]">
                            {project.name}
                          </span>
                          {project.code ? (
                            <span className="font-mono text-[11px] text-[var(--text-faint)]">
                              {project.code}
                            </span>
                          ) : null}
                        </p>
                        {project.summary ? (
                          <p className="mt-0.5 line-clamp-1 text-[12px] text-[var(--text-muted)]">
                            {project.summary}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {project.status === "active" ? (
                          <StatusBadge map={PROJECT_HEALTH} value={project.health} dot />
                        ) : null}
                        <StatusBadge map={PROJECT_STATUS} value={project.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card id="people" className="scroll-mt-20">
            <CardHeader
              title="People"
              meta="Who we actually deal with, and what makes them tick"
            />
            <CardBody>
              <ContactsPanel customerId={customer.id} contacts={customer.contacts} />
            </CardBody>
          </Card>

          <RecordTasks
            scope={{ customerId: customer.id }}
            revalidate={`/customers/${customer.id}`}
            placeholder="Send the quarterly report…"
          />

          <Card id="history" className="scroll-mt-20">
            <CardHeader
              title="Communications"
              meta={`${entries.length} logged · emails linked from Microsoft 365 appear here`}
              action={
                <ButtonLink href={`/inbox?customer=${customer.id}`} variant="ghost" size="sm">
                  <Mail />
                  Link email
                </ButtonLink>
              }
            />
            <CardBody className="flex flex-col gap-4">
              <LogCommunication
                customerId={customer.id}
                contactOptions={customer.contacts.map((c) => ({
                  id: c.id,
                  label: `${c.firstName} ${c.lastName ?? ""}`.trim(),
                }))}
                redirectTo={`/customers/${customer.id}`}
              />
              <Timeline
                entries={entries}
                showProject
                currentUserId={user.id}
                canModerate={user.role === "admin"}
                revalidate={`/customers/${customer.id}`}
              />
            </CardBody>
          </Card>

          <Card id="accounts" className="scroll-mt-20">
            <CardHeader
              title="Account register"
              meta="Systems this business partner owns, and where the credentials live — never the credentials themselves"
            />
            <CardBody>
              <AccountRegister
                accounts={customer.accounts}
                customerId={customer.id}
                revalidate={`/customers/${customer.id}`}
              />
            </CardBody>
          </Card>

          <Card id="xero" className="scroll-mt-20">
            <CardHeader
              title="Xero"
              meta={
                customer.xeroContactId
                  ? "Balances and invoice history, read live from Xero"
                  : "Not linked to a Xero contact yet"
              }
            />
            <CardBody>
              <XeroAccount
                customerId={customer.id}
                isCustomer={customer.isCustomer}
                isSupplier={customer.isSupplier}
                linkedName={xero.contact?.name ?? (customer.xeroContactId ? "Xero contact" : null)}
                balances={xero.contact?.balances ?? null}
                invoices={xero.invoices}
                error={xero.error}
                needsReconnect={xero.needsReconnect}
                connected={xeroLive}
              />
            </CardBody>
          </Card>

          <Card id="details" className="scroll-mt-20">
            <CardHeader title="Business partner details" />
            <CardBody>
              <CustomerForm
                action={updateCustomer.bind(null, customer.id)}
                customer={customer}
                team={team}
                submitLabel="Save changes"
                cancelHref="/customers"
              />
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card id="files" className="scroll-mt-20">
            <CardHeader title="Files" meta="Stored in SharePoint" />
            <CardBody>
              {customer.spDriveId && customer.spItemId ? (
                <>
                  <FilesPanel
                    driveId={customer.spDriveId}
                    rootItemId={customer.spItemId}
                    rootName={customer.name}
                    webUrl={customer.spWebUrl}
                    initialItems={folder.items}
                    initialError={folder.error}
                  />
                  <CheckStructure customerId={customer.id} />
                </>
              ) : (
                <ConnectFolder
                  scope={{ customerId: customer.id }}
                  libraryReady={Boolean(settings?.spDriveId)}
                  canConfigure={user.role === "admin"}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Copilot brief" meta="So Copilot can answer about them" />
            <CardBody>
              <CopilotBrief
                customerId={customer.id}
                writtenAt={customer.briefWrittenAt}
                hasFolder={Boolean(customer.spDriveId && customer.spItemId)}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Account" />
            <CardBody>
              <dl className="divide-y divide-[var(--border-soft)]">
                <DataRow label="Owner">
                  {customer.owner ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar
                        name={customer.owner.name}
                        src={customer.owner.photo}
                        size="xs"
                      />
                      {customer.owner.name}
                    </span>
                  ) : (
                    <span className="text-[var(--text-faint)]">Unassigned</span>
                  )}
                </DataRow>
                <DataRow label="Legal entity">{customer.legalName ?? "—"}</DataRow>
                <DataRow label="ABN">
                  <span className="tabular">{customer.abn ?? "—"}</span>
                </DataRow>
                <DataRow label="Segment">{customer.segment ?? "—"}</DataRow>
                <DataRow label="Partner since">{formatDate(customer.createdAt)}</DataRow>
              </dl>

              {customer.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--border-soft)] pt-3">
                  {customer.tags.map((tag) => (
                    <Badge key={tag} tone="brand">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>

          {customer.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <p className="text-[13px] leading-6 whitespace-pre-line text-[var(--text)]">
                  {customer.notes}
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
