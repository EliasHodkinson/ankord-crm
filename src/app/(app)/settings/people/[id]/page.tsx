import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataRow } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import {
  FILE_ACCESS,
  FOLDER_GRANT_STATUS,
  StatusBadge,
  USER_ROLE,
} from "@/components/ui/status";
import { getPerson } from "@/lib/data/people";
import { requireAdmin } from "@/lib/auth/session";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { sectionsFrom } from "@/lib/sections";
import {
  ActiveControl,
  GrantsForm,
  RetryFolder,
  RoleControl,
  SectionsForm,
} from "../person-controls";

export const metadata: Metadata = { title: "Access" };
export const dynamic = "force-dynamic";

export default async function PersonAccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireAdmin();
  const { id } = await params;
  const record = await getPerson(id);
  if (!record) notFound();

  const { person, grants, folders, customers } = record;
  const isSelf = person.id === user.id;
  const initial = Object.fromEntries(grants.map((g) => [g.customerId, g.fileAccess]));
  const live = folders.filter((f) => !f.revokedAt);
  const history = folders.filter((f) => f.revokedAt);

  return (
    <>
      <PageHeader
        title={person.name}
        crumbs={[
          { label: "Settings", href: "/settings" },
          { label: "People and access", href: "/settings/people" },
          { label: person.name },
        ]}
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge map={USER_ROLE} value={person.role} />
            {person.isGuest ? <Badge tone="neutral">Guest</Badge> : null}
            {person.isActive ? null : <Badge tone="muted">Suspended</Badge>}
          </span>
        }
        description={person.email}
      />

      <PageBody className="flex max-w-4xl flex-col gap-5">
        <Card>
          <CardHeader title="Access" />
          <CardBody>
            <dl className="divide-y divide-[var(--border-soft)]">
              <DataRow label="Role">
                <RoleControl
                  userId={person.id}
                  role={person.role}
                  roleSource={person.roleSource}
                  isSelf={isSelf}
                />
              </DataRow>
              <DataRow label="Sign-in">
                <ActiveControl userId={person.id} isActive={person.isActive} isSelf={isSelf} />
              </DataRow>
              <DataRow label="Account">
                {person.isGuest
                  ? "Entra B2B guest — signs in with their own email, no Ankor'd licence"
                  : "Ankor'd tenant member"}
              </DataRow>
              <DataRow label="Last seen">
                {person.lastSeenAt
                  ? formatDateTime(person.lastSeenAt)
                  : person.invitedAt
                    ? `Invited ${relativeTime(person.invitedAt)} — not signed in yet`
                    : "Never"}
              </DataRow>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Business partners they can see"
            meta={
              person.role === "restricted"
                ? "Everything else in the CRM is hidden from them — leads, reports, other partners, search results"
                : "Not in force: this role already sees every record. These apply if they are restricted."
            }
          />
          <CardBody>
            <GrantsForm
              userId={person.id}
              customers={customers.map((c) => ({
                id: c.id,
                name: c.name,
                hasFolder: c.hasFolder,
                archived: c.archived,
              }))}
              initial={initial}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Sections they can open"
            meta={
              person.role === "restricted"
                ? "Within those partners, only these parts of the CRM. Overview is always there — it is where they land."
                : "Not in force: this role opens every section. These apply if they are restricted."
            }
          />
          <CardBody>
            <SectionsForm
              key={(person.sections ?? []).join()}
              userId={person.id}
              initial={sectionsFrom(person.sections)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="SharePoint"
            meta="Folder permissions the CRM has applied for them. Revoking a partner removes only what is listed here."
          />
          {live.length === 0 ? (
            <EmptyState
              compact
              title="Nothing shared"
              description={
                person.role === "restricted"
                  ? "Tick a business partner above and save — its folder is shared with them as you."
                  : "Staff reach the library through the SharePoint site itself."
              }
            />
          ) : (
            <TableShell className="rounded-none border-x-0 border-b-0 shadow-none">
              <Table className="min-w-[40rem]">
                <thead>
                  <tr>
                    <Th>Folder</Th>
                    <Th>Level</Th>
                    <Th>State</Th>
                    <Th>When</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {live.map((row) => (
                    <Tr key={row.id}>
                      <Td className="font-medium text-[var(--text)]">
                        {row.customerName ?? "A deleted business partner"}
                      </Td>
                      <Td>
                        <StatusBadge map={FILE_ACCESS} value={row.role} />
                      </Td>
                      <Td>
                        <span className="flex flex-col gap-1">
                          <StatusBadge map={FOLDER_GRANT_STATUS} value={row.status} dot />
                          {row.error ? (
                            <span className="max-w-[28ch] text-[11px] leading-4 text-[var(--danger)]">
                              {row.error}
                            </span>
                          ) : null}
                        </span>
                      </Td>
                      <Td className="text-[12px] text-[var(--text-muted)]">
                        {relativeTime(row.appliedAt)}
                        {row.appliedByName ? ` · ${row.appliedByName}` : ""}
                      </Td>
                      <Td className="text-right">
                        {row.customerId &&
                        (row.status === "failed" || row.status === "revoke_failed") ? (
                          <RetryFolder userId={person.id} customerId={row.customerId} />
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableShell>
          )}
          {history.length ? (
            <CardBody className="border-t border-[var(--border-soft)]">
              <details>
                <summary className="cursor-pointer text-[12px] font-medium text-[var(--text-muted)]">
                  Earlier changes ({history.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
                  {history.map((row) => (
                    <li key={row.id}>
                      {row.customerName ?? "A deleted business partner"} ·{" "}
                      {FOLDER_GRANT_STATUS[row.status]?.label ?? row.status} ·{" "}
                      {formatDateTime(row.revokedAt)}
                    </li>
                  ))}
                </ul>
              </details>
            </CardBody>
          ) : null}
        </Card>
      </PageBody>
    </>
  );
}
