import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, TriangleAlert } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { StatusBadge, USER_ROLE } from "@/components/ui/status";
import { listCustomerChoices, listPeople } from "@/lib/data/people";
import { requireAdmin, sessionScopes } from "@/lib/auth/session";
import { hasAccessAdminScopes } from "@/lib/auth/entra";
import { relativeTime } from "@/lib/utils";
import { AddPersonForm } from "./add-person-form";

export const metadata: Metadata = { title: "People and access" };
export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const { user } = await requireAdmin();
  const [people, customers, scopes] = await Promise.all([
    listPeople(),
    listCustomerChoices(),
    sessionScopes(),
  ]);
  const canInvite = hasAccessAdminScopes(scopes);

  return (
    <>
      <PageHeader
        title="People and access"
        crumbs={[{ label: "Settings", href: "/settings" }, { label: "People and access" }]}
        description="Who can sign in to The Gangway, and what each of them can see. A restricted person sees only the business partners granted here — and gets those partners' SharePoint folders shared with them."
      />

      <PageBody className="flex max-w-5xl flex-col gap-5">
        <Card>
          <CardHeader
            title="Everyone"
            meta={`${people.filter((p) => p.isActive).length} can sign in`}
          />
          <TableShell className="rounded-none border-x-0 border-b-0 shadow-none">
            <Table className="min-w-[44rem]">
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Access</Th>
                  <Th>Sees</Th>
                  <Th>Last seen</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <Tr key={person.id}>
                    <Td>
                      <Link
                        href={`/settings/people/${person.id}`}
                        className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                      >
                        <Avatar name={person.name} src={person.photo} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--text)] hover:underline underline-offset-2">
                            {person.name}
                            {person.id === user.id ? (
                              <span className="ml-1.5 text-[11px] font-normal text-[var(--text-faint)]">
                                you
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-[12px] text-[var(--text-muted)]">
                            {person.email}
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge map={USER_ROLE} value={person.role} />
                        {person.isGuest ? <Badge tone="neutral">Guest</Badge> : null}
                        {person.roleSource === "entra" ? (
                          <span className="text-[11px] text-[var(--text-faint)]">via Entra</span>
                        ) : null}
                      </span>
                    </Td>
                    <Td className="text-[12px] text-[var(--text-muted)]">
                      {person.role === "restricted" ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {person.grantCount === 0
                            ? "Nothing yet"
                            : `${person.grantCount} ${person.grantCount === 1 ? "partner" : "partners"}`}
                          {person.folderProblems > 0 ? (
                            <Badge tone="danger" dot>
                              SharePoint needs attention
                            </Badge>
                          ) : null}
                        </span>
                      ) : (
                        "Every record"
                      )}
                    </Td>
                    <Td className="text-[12px] text-[var(--text-muted)]">
                      {person.lastSeenAt
                        ? relativeTime(person.lastSeenAt)
                        : person.invitedAt
                          ? "Invited, not signed in yet"
                          : "Never"}
                    </Td>
                    <Td>
                      <Badge tone={person.isActive ? "ok" : "muted"} dot>
                        {person.isActive ? "Active" : "Suspended"}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableShell>
        </Card>

        <Card>
          <CardHeader
            title="Add a person"
            meta="Before they sign in for the first time"
          />
          <CardBody className="flex flex-col gap-5">
            {canInvite ? null : (
              <div className="flex flex-col gap-2.5 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2.5 sm:flex-row sm:items-center">
                <TriangleAlert className="size-4 shrink-0 text-[var(--warn)]" />
                <p className="flex-1 text-[12px] leading-5 text-[var(--text-muted)]">
                  Adding someone already in the Ankor&rsquo;d tenant works as it is. Inviting a
                  guest from outside needs one more Microsoft permission on your sign-in,{" "}
                  <code className="font-mono text-[11px]">User.Invite.All</code>, which an Entra
                  admin must have consented to for the app.
                </p>
                <ButtonLink
                  href="/api/auth/signin?scopes=access&next=/settings/people"
                  size="sm"
                  variant="secondary"
                  prefetch={false}
                >
                  <KeyRound />
                  Allow inviting guests
                </ButtonLink>
              </div>
            )}
            <AddPersonForm customers={customers} />
          </CardBody>
        </Card>
      </PageBody>
    </>
  );
}
