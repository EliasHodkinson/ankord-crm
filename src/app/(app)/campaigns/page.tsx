import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageBody } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/charts";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { CAMPAIGN_STATUS, StatusBadge } from "@/components/ui/status";
import { requireUser } from "@/lib/auth/session";
import { requireStaffPage } from "@/lib/access";
import { audienceHealth, listCampaigns } from "@/lib/data/campaigns";
import { percent } from "@/lib/campaigns/model";
import { daysBack, formatDate, formatDateTime } from "@/lib/utils";
import { MarketingHeader } from "./marketing-header";

export const metadata: Metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireUser();
  await requireStaffPage();
  const { status, q } = await searchParams;

  const [rows, all, health] = await Promise.all([
    listCampaigns({ status, q }),
    listCampaigns({ status: "sent" }),
    audienceHealth(),
  ]);

  // Averages over what has actually gone out in the last 90 days.
  const since = daysBack(90).getTime();
  const recent = all.filter((r) => (r.campaign.startedAt?.getTime() ?? 0) >= since);
  const sent = recent.reduce((n, r) => n + r.stats.sent, 0);
  const opened = recent.reduce((n, r) => n + r.stats.opened, 0);
  const clicked = recent.reduce((n, r) => n + r.stats.clicked, 0);
  const reachable = health.withEmail - health.suppressed;

  return (
    <>
      <MarketingHeader
        title="Campaigns"
        description="Marketing email written, sent and measured from The Gangway — from your own mailbox or the marketing one."
        actions={
          <ButtonLink href="/campaigns/new" variant="primary">
            <Plus />
            New campaign
          </ButtonLink>
        }
      />

      <PageBody className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Sent in the last 90 days" value={sent.toLocaleString("en-AU")} detail={`${recent.length} ${recent.length === 1 ? "campaign" : "campaigns"}`} />
          <StatTile label="Open rate" value={percent(opened, sent)} detail="Unique opens ÷ sent" />
          <StatTile label="Click rate" value={percent(clicked, sent)} detail="Unique clicks ÷ sent" />
          <StatTile
            label="People you can reach"
            value={reachable.toLocaleString("en-AU")}
            detail={`${health.suppressed} unsubscribed or bounced`}
          />
        </div>

        <FilterBar
          searchPlaceholder="Search campaigns…"
          filters={[
            {
              param: "status",
              label: "Show",
              defaultValue: "all",
              options: [
                { value: "all", label: "All campaigns" },
                { value: "drafts", label: "Drafts" },
                { value: "active", label: "Scheduled and sending" },
                { value: "sent", label: "Sent" },
              ],
            },
          ]}
        />

        {rows.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={q || status ? "No campaigns match" : "Send your first campaign"}
              description={
                q || status
                  ? "Try a different word, or show all campaigns."
                  : "Start from an Ankor'd template, choose who it goes to from the people already in The Gangway, and send a test to yourself before it goes."
              }
              action={
                <ButtonLink href="/campaigns/new" variant="primary">
                  <Plus />
                  New campaign
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <TableShell>
            <Table>
              <thead>
                <tr>
                  <Th>Campaign</Th>
                  <Th>Status</Th>
                  <Th numeric>Recipients</Th>
                  <Th numeric>Opened</Th>
                  <Th numeric>Clicked</Th>
                  <Th>When</Th>
                  <Th>By</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ campaign: c, stats, senderName }) => {
                  const when =
                    c.status === "scheduled" && c.scheduledAt
                      ? `For ${formatDateTime(c.scheduledAt)}`
                      : c.startedAt
                        ? formatDateTime(c.startedAt)
                        : `Edited ${formatDate(c.updatedAt)}`;
                  return (
                    <Tr key={c.id}>
                      <Td className="max-w-[26rem]">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="block truncate font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline underline-offset-2"
                        >
                          {c.name}
                        </Link>
                        <span className="block truncate text-[12px] text-[var(--text-muted)]">
                          {c.subject || "No subject yet"}
                        </span>
                      </Td>
                      <Td>
                        <StatusBadge map={CAMPAIGN_STATUS} value={c.status} dot={c.status === "sending" || c.status === "testing"} />
                      </Td>
                      <Td numeric>{stats.recipients ? stats.recipients.toLocaleString("en-AU") : "—"}</Td>
                      <Td numeric>{stats.sent ? percent(stats.opened, stats.sent) : "—"}</Td>
                      <Td numeric>{stats.sent ? percent(stats.clicked, stats.sent) : "—"}</Td>
                      <Td className="whitespace-nowrap text-[var(--text-muted)]">{when}</Td>
                      <Td className="text-[var(--text-muted)]">{senderName ?? "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableShell>
        )}
      </PageBody>
    </>
  );
}
