import type { Metadata } from "next";
import { Unplug } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { listConnections } from "@/lib/data/connections";
import { endConnection } from "@/lib/actions/connections";
import { mcpUrl } from "@/lib/mcp/tokens";
import { formatDate, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Claude connections" };
export const dynamic = "force-dynamic";

/**
 * Open to everyone who can sign in, restricted people included: a connection
 * is theirs, and so is ending it. Admins see and can end everyone's.
 */
export default async function ConnectionsPage() {
  const { user } = await requireUser();
  const connections = await listConnections();
  const isAdmin = user.role === "admin";
  const url = mcpUrl();

  return (
    <>
      <PageHeader
        title="Claude connections"
        crumbs={user.role === "restricted" ? undefined : [{ label: "Settings", href: "/settings" }, { label: "Claude connections" }]}
        description="Claude (or another MCP client) connected here reads and updates The Gangway as you — with your role, your business partners and your Microsoft 365 access, never more. Everything it changes is logged as you, marked as coming through Claude."
      />

      <PageBody className="flex max-w-5xl flex-col gap-5">
        <Card>
          <CardHeader title="Connect" meta="Add this address as a custom connector, then sign in with Microsoft when asked" />
          <CardBody className="flex flex-col gap-3 text-[13px] leading-6 text-[var(--text-muted)]">
            <code className="block overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-[13px] text-[var(--text)]">
              {url}
            </code>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <span className="font-medium text-[var(--text)]">claude.ai or Claude Desktop</span> — Settings →
                Connectors → Add custom connector, paste the address.
              </li>
              <li>
                <span className="font-medium text-[var(--text)]">Claude Code</span> —{" "}
                <code className="font-mono text-[12px] text-[var(--text)]">claude mcp add --transport http the-gangway {url}</code>
                , then <code className="font-mono text-[12px] text-[var(--text)]">/mcp</code> to sign in.
              </li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={isAdmin ? "Everyone's connections" : "Your connections"}
            meta={`${connections.length} active`}
          />
          {connections.length === 0 ? (
            <EmptyState
              compact
              title="Nothing connected"
              description="Connections you approve appear here, and can be ended at any time."
            />
          ) : (
            <TableShell className="rounded-none border-x-0 border-b-0 shadow-none">
              <Table className="min-w-[40rem]">
                <thead>
                  <tr>
                    <Th>Client</Th>
                    {isAdmin ? <Th>Person</Th> : null}
                    <Th>Connected</Th>
                    <Th>Last active</Th>
                    <Th>Lapses if unused</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {connections.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <p className="font-medium text-[var(--text)]">{c.client}</p>
                        <p className="text-[12px] text-[var(--text-faint)]">
                          {c.clientKind === "cimd" ? new URL(c.clientId).host : "Self-registered client"}
                        </p>
                      </Td>
                      {isAdmin ? <Td>{c.personId === user.id ? "You" : c.person}</Td> : null}
                      <Td>{formatDate(c.createdAt)}</Td>
                      <Td>{relativeTime(c.lastUsedAt)}</Td>
                      <Td>{formatDate(c.expiresAt)}</Td>
                      <Td className="text-right">
                        <form action={endConnection.bind(null, c.id)}>
                          <Button type="submit" size="sm" variant="ghost">
                            <Unplug />
                            End
                          </Button>
                        </form>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableShell>
          )}
        </Card>
      </PageBody>
    </>
  );
}
