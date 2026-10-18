import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, SUPPRESSION_REASON } from "@/components/ui/status";
import { formatDate } from "@/lib/utils";
import type { marketingForCustomer } from "@/lib/data/campaigns";

/**
 * On a business partner: the campaigns their people received and what they
 * did with them, and who has opted out. A broadcast is not a conversation, so
 * none of this counts as activity.
 */
export function MarketingCard({
  marketing,
}: {
  marketing: NonNullable<Awaited<ReturnType<typeof marketingForCustomer>>>;
}) {
  const { received, suppressed } = marketing;
  if (!received.length && !suppressed.length) return null;
  return (
    <Card>
      <CardHeader
        title="Marketing email"
        meta={received.length ? `${received.length} sent to their people` : "Nothing sent yet"}
        action={
          <Link href="/campaigns" className="text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
            Campaigns
          </Link>
        }
      />
      {suppressed.length ? (
        <ul className="flex flex-col gap-1.5 border-b border-[var(--border-soft)] px-4 py-3">
          {suppressed.map((s) => (
            <li key={s.email} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="truncate text-[var(--text)]">{s.email}</span>
              <StatusBadge map={SUPPRESSION_REASON} value={s.reason} />
            </li>
          ))}
        </ul>
      ) : null}
      <ul>
        {received.slice(0, 8).map((r) => (
          <li key={`${r.campaignId}-${r.email}`} className="border-b border-[var(--border-soft)] px-4 py-2.5 last:border-0">
            <div className="flex items-baseline justify-between gap-2">
              <Link href={`/campaigns/${r.campaignId}`} className="truncate text-[13px] font-medium text-[var(--text)] hover:underline underline-offset-2">
                {r.name}
              </Link>
              <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{formatDate(r.sentAt)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="truncate text-[12px] text-[var(--text-muted)]">
                {[r.firstName, r.lastName].filter(Boolean).join(" ") || r.email}
              </span>
              {r.clicked ? <Badge tone="ok">Clicked</Badge> : r.opened ? <Badge tone="info">Opened</Badge> : <Badge tone="muted">Not opened</Badge>}
              {r.unsubscribed ? <Badge tone="warn">Unsubscribed</Badge> : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
